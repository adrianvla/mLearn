//! Two native read leases; cancellation acknowledgement is execution drainage.
use crate::execution::Failure;
use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Condvar, Mutex,
    },
    time::{Duration, Instant},
};

static NEXT_ID: Mutex<u64> = Mutex::new(1);
const RESERVATION_TTL: Duration = Duration::from_secs(30);

#[derive(Debug, thiserror::Error)]
pub enum BoundedReadError {
    #[error("Bounded native reads or cancellation controls are busy")]
    Busy,
    #[error("Bounded read handle is missing, expired, or already claimed")]
    InvalidHandle,
    #[error("Native bounded read identities exhausted")]
    IdExhausted,
    #[error("Native bounded read lock poisoned")]
    Poisoned,
}

impl BoundedReadError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Busy => "busy",
            Self::InvalidHandle => "invalid_bounded_read",
            Self::IdExhausted | Self::Poisoned => "operation_failed",
        }
    }
}

impl From<BoundedReadError> for Failure {
    fn from(error: BoundedReadError) -> Self {
        match error {
            BoundedReadError::Busy => Self::Busy,
            BoundedReadError::InvalidHandle => Self::Protocol(error.code(), error.to_string()),
            BoundedReadError::IdExhausted | BoundedReadError::Poisoned => {
                Self::Operation(error.to_string())
            }
        }
    }
}

pub(super) struct Lease {
    id: String,
    pub epoch: u64,
    pub cancelled: Arc<AtomicBool>,
    pub wake: Arc<Condvar>,
    done: Mutex<bool>,
    completed: Condvar,
}

struct Entry {
    lease: Arc<Lease>,
    registered: Instant,
    claimed: bool,
}

#[derive(Default)]
pub(super) struct BoundedReads {
    entries: Mutex<[Option<Entry>; 2]>,
    controls: Mutex<usize>,
}

impl BoundedReads {
    fn expire(entries: &mut [Option<Entry>; 2], epoch: u64, now: Instant) {
        for slot in entries {
            if slot.as_ref().is_some_and(|entry| {
                !entry.claimed
                    && (entry.lease.epoch != epoch
                        || now.saturating_duration_since(entry.registered) >= RESERVATION_TTL)
            }) {
                *slot = None;
            }
        }
    }

    pub fn begin(&self, source: &AtomicU64, now: Instant) -> Result<String, BoundedReadError> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| BoundedReadError::Poisoned)?;
        let epoch = source.load(Ordering::Relaxed);
        Self::expire(&mut entries, epoch, now);
        let slot = entries
            .iter_mut()
            .find(|slot| slot.is_none())
            .ok_or(BoundedReadError::Busy)?;
        // Process-wide, checked monotonic identity prevents reuse across executors
        // without retaining completed IDs or accepting caller-chosen identities.
        let id = {
            let mut next = NEXT_ID.lock().map_err(|_| BoundedReadError::Poisoned)?;
            let id = *next;
            *next = id.checked_add(1).ok_or(BoundedReadError::IdExhausted)?;
            id
        };
        let id = format!("br-{id:016x}");
        *slot = Some(Entry {
            lease: Arc::new(Lease {
                id: id.clone(),
                epoch,
                cancelled: Arc::new(AtomicBool::new(false)),
                wake: Arc::new(Condvar::new()),
                done: Mutex::new(false),
                completed: Condvar::new(),
            }),
            registered: now,
            claimed: false,
        });
        Ok(id)
    }

    pub fn claim(
        &self,
        id: &str,
        source: &AtomicU64,
        now: Instant,
    ) -> Result<Claimed<'_>, BoundedReadError> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| BoundedReadError::Poisoned)?;
        let epoch = source.load(Ordering::Relaxed);
        Self::expire(&mut entries, epoch, now);
        let entry = entries
            .iter_mut()
            .flatten()
            .find(|entry| entry.lease.id == id)
            .ok_or(BoundedReadError::InvalidHandle)?;
        if entry.claimed {
            return Err(BoundedReadError::InvalidHandle);
        }
        entry.claimed = true;
        Ok(Claimed {
            owner: self,
            lease: Arc::clone(&entry.lease),
        })
    }

    pub fn control(&self) -> Result<Control<'_>, BoundedReadError> {
        let mut active = self
            .controls
            .lock()
            .map_err(|_| BoundedReadError::Poisoned)?;
        if *active >= 2 {
            return Err(BoundedReadError::Busy);
        }
        *active += 1;
        Ok(Control(&self.controls))
    }

    /// Removes only unclaimed reservations. Claimed leases remain charged.
    pub fn cancel(&self, id: &str) -> Result<Option<Arc<Lease>>, BoundedReadError> {
        if id.len() != 19
            || !id.starts_with("br-")
            || !id[3..].bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(BoundedReadError::InvalidHandle);
        }
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| BoundedReadError::Poisoned)?;
        let Some(slot) = entries
            .iter_mut()
            .find(|slot| slot.as_ref().is_some_and(|entry| entry.lease.id == id))
        else {
            return Ok(None);
        };
        let Some(entry) = slot.as_ref() else {
            return Ok(None);
        };
        entry.lease.cancelled.store(true, Ordering::Release);
        if entry.claimed {
            Ok(Some(Arc::clone(&entry.lease)))
        } else {
            *slot = None;
            Ok(None)
        }
    }
}

impl Lease {
    pub fn join(&self) -> Result<(), BoundedReadError> {
        let mut done = self.done.lock().map_err(|_| BoundedReadError::Poisoned)?;
        while !*done {
            done = self
                .completed
                .wait(done)
                .map_err(|_| BoundedReadError::Poisoned)?;
        }
        Ok(())
    }
}

pub(super) struct Claimed<'a> {
    owner: &'a BoundedReads,
    pub lease: Arc<Lease>,
}

impl Drop for Claimed<'_> {
    fn drop(&mut self) {
        {
            // Recovery only clears this RAII owner's identity after unwind; it
            // does not admit new work through a poisoned registry.
            let mut entries = self
                .owner
                .entries
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            for slot in entries.iter_mut() {
                if slot
                    .as_ref()
                    .is_some_and(|entry| Arc::ptr_eq(&entry.lease, &self.lease))
                {
                    *slot = None;
                }
            }
        }
        {
            let mut done = self
                .lease
                .done
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            *done = true;
        }
        self.lease.completed.notify_all();
    }
}

pub(super) struct Control<'a>(&'a Mutex<usize>);
impl Drop for Control<'_> {
    fn drop(&mut self) {
        *self.0.lock().unwrap_or_else(|error| error.into_inner()) -= 1;
    }
}
