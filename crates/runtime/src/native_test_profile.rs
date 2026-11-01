//! Fixture lifetime admission for the language host's one process-wide guest.
use std::ops::Deref;
use std::sync::{Mutex, MutexGuard};

static GUEST_FIXTURE: Mutex<()> = Mutex::new(());

pub(crate) struct NativeTestProfile {
    directory: tempfile::TempDir,
    _guest: MutexGuard<'static, ()>,
}

impl NativeTestProfile {
    pub fn new() -> Self {
        // Scoped guest calls deliberately return Busy across independent owners.
        // Serialize fixtures, not their worker threads or production execution.
        // The mutex protects admission only; a failed test cannot poison data.
        let guest = GUEST_FIXTURE
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        Self {
            directory: tempfile::tempdir().unwrap(),
            _guest: guest,
        }
    }
}

impl Deref for NativeTestProfile {
    type Target = tempfile::TempDir;

    fn deref(&self) -> &Self::Target {
        &self.directory
    }
}
