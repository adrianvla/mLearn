/** Resume a cancelled Electron quit after its native event dispatch has returned. */
export function resumeQuitAfterCheckpoint(
  checkpoint: Promise<void>,
  onError: (error: unknown) => void,
  quit: () => void,
): void {
  void checkpoint.catch(onError).finally(() => {
    // A settled checkpoint can run its Promise callbacks inside will-quit.
    // Electron still considers itself quitting there and ignores app.quit().
    // Yield one event-loop turn so preventDefault has reset that native state.
    setImmediate(quit);
  });
}
