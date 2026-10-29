//! One logical guest slot shared by foreground, background and management work.
use crate::execution::{Cancellation, Failure};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, TryLockError};

#[derive(Default)]
struct State {
    occupied: bool,
    waiters: [Option<Arc<Condvar>>; 2],
    #[cfg(test)]
    waiting: Option<std::sync::mpsc::SyncSender<()>>,
}

#[derive(Default)]
pub(super) struct GuestGate {
    state: Mutex<State>,
    available: Condvar,
}

fn poisoned() -> Failure {
    Failure::Operation("Native guest admission lock poisoned".into())
}

impl GuestGate {
    pub fn lock(&self) -> Result<GuestGuard<'_>, Failure> {
        let mut state = self.state.lock().map_err(|_| poisoned())?;
        while state.occupied {
            state = self.available.wait(state).map_err(|_| poisoned())?;
        }
        state.occupied = true;
        Ok(GuestGuard(self))
    }

    pub fn try_lock(&self) -> Result<GuestGuard<'_>, Failure> {
        let mut state = self.state.try_lock().map_err(|error| match error {
            TryLockError::WouldBlock => Failure::Busy,
            TryLockError::Poisoned(_) => poisoned(),
        })?;
        if state.occupied {
            return Err(Failure::Busy);
        }
        state.occupied = true;
        Ok(GuestGuard(self))
    }

    pub fn lock_cancellable(
        &self,
        cancellation: &Cancellation,
        wake: &Arc<Condvar>,
    ) -> Result<GuestGuard<'_>, Failure> {
        let mut state = self.state.lock().map_err(|_| poisoned())?;
        cancellation.check()?;
        let index = state.waiters.iter().position(Option::is_none).ok_or(Failure::Busy)?;
        state.waiters[index] = Some(Arc::clone(wake));
        loop {
            if let Err(error) = cancellation.check() {
                state.waiters[index] = None;
                return Err(error);
            }
            if !state.occupied {
                state.waiters[index] = None;
                state.occupied = true;
                return Ok(GuestGuard(self));
            }
            #[cfg(test)]
            if let Some(waiting) = state.waiting.take() {
                waiting.send(()).unwrap();
            }
            state = match wake.wait(state) {
                Ok(state) => state,
                Err(error) => {
                    error.into_inner().waiters[index] = None;
                    return Err(poisoned());
                }
            };
        }
    }

    /// Synchronize with check -> wait, then notify without holding state.
    pub fn notify_operation(&self, wake: &Condvar) {
        drop(self.state.lock().unwrap_or_else(|error| error.into_inner()));
        wake.notify_all();
    }

    pub fn notify_source_change(&self) {
        let waiters = {
            let state = self.state.lock().unwrap_or_else(|error| error.into_inner());
            state.waiters.clone()
        };
        for wake in waiters.into_iter().flatten() {
            wake.notify_all();
        }
    }

    #[cfg(test)]
    pub fn observe_waiter(&self) -> std::sync::mpsc::Receiver<()> {
        let (waiting, ready) = std::sync::mpsc::sync_channel(1);
        self.state.lock().unwrap().waiting = Some(waiting);
        ready
    }
}

pub(super) struct GuestGuard<'a>(&'a GuestGate);
impl Drop for GuestGuard<'_> {
    fn drop(&mut self) {
        let waiters = {
            let mut state: MutexGuard<'_, State> =
                self.0.state.lock().unwrap_or_else(|error| error.into_inner());
            state.occupied = false;
            state.waiters.clone()
        };
        self.0.available.notify_all();
        for wake in waiters.into_iter().flatten() {
            wake.notify_all();
        }
    }
}
