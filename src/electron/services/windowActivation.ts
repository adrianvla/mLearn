/** Prevent native activation events from starting windows before startup owns its services. */
export function createWindowActivation(
  focusExisting: () => boolean,
  createWindow: () => void,
): { activate: () => void; markReady: () => void } {
  let ready = false;
  return {
    activate: () => {
      if (focusExisting()) return;
      if (ready) createWindow();
    },
    markReady: () => { ready = true; },
  };
}
