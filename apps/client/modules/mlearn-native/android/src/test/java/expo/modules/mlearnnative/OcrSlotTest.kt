package expo.modules.mlearnnative

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OcrSlotTest {
  @Test fun sourceDisplayDoesNotWaitForOrReleaseAnActiveSdkInference() {
    // Given an SDK operation that owns its input until actual completion.
    val host = OcrHost { error("Display admission must not invoke learner storage") }
    host.reserve("recognition")
    val inference = host.start("recognition")
    // When the user navigates to another source page.
    val display = host.reserveDisplay()
    assertFalse(display.runtimeRequest)
    var displayed = false
    host.publish(display) { displayed = true }
    assertTrue(displayed)
    assertThrows(IllegalStateException::class.java) { host.reserveDisplay() }
    host.finish(display)
    // Then display has its own bound and cannot release the running SDK input.
    assertThrows(IllegalStateException::class.java) { host.reserve("second-inference") }
    host.finish(inference)
    val retainedDisplay = host.reserveDisplay()
    assertEquals(null, host.close())
    assertThrows(IllegalStateException::class.java) { host.publish(retainedDisplay) {} }
    host.finish(retainedDisplay)
    assertThrows(IllegalStateException::class.java) { host.reserveDisplay() }
  }

  @Test fun cancelledSdkTaskRetainsSlotUntilActualCompletion() {
    // Given an active SDK operation.
    val slot = OcrSlot()
    slot.reserve("first")
    val first = slot.start("first")
    // When native publication is cancelled before the SDK completes.
    slot.cancel("first")
    // Then publication fails, and a second operation cannot acquire resources.
    assertThrows(IllegalStateException::class.java) { slot.check(first) }
    assertThrows(IllegalStateException::class.java) { slot.reserve("second") }
    slot.finish(first) // The real completion signal, not cancellation, releases.
    slot.reserve("second")
    slot.check(slot.start("second"))
  }

  @Test fun cancellationBeforeExecutionReleasesReservationImmediately() {
    // Given an admitted request that has not begun native execution.
    val slot = OcrSlot()
    slot.reserve("queued")
    // When cancellation arrives.
    slot.cancel("queued")
    // Then no queued request can begin and a replacement may reserve.
    assertThrows(IllegalStateException::class.java) { slot.start("queued") }
    slot.reserve("replacement")
    slot.check(slot.start("replacement"))
  }

  @Test fun teardownInvalidatesActivePublicationAndRejectsNewWork() {
    // Given an in-flight operation and its retained bitmap.
    val slot = OcrSlot()
    slot.reserve("active")
    val ticket = slot.start("active")
    // When the module is destroyed.
    val cancelled = slot.close()
    // Then publication is invalid, and completion cannot reopen the module.
    assertEquals("active", cancelled)
    assertThrows(IllegalStateException::class.java) { slot.check(ticket) }
    slot.finish(ticket)
    assertThrows(IllegalStateException::class.java) { slot.reserve("next") }
  }

  @Test fun duplicateExecutionCannotConsumeTheSameReservation() {
    // Given a started request.
    val slot = OcrSlot()
    slot.reserve("same")
    slot.start("same")
    // When the transport retries the same native execution before completion.
    // Then there is still exactly one SDK operation.
    assertThrows(IllegalStateException::class.java) { slot.start("same") }
  }

  @Test fun cancellationRacingSdkCompletionCannotPublishItsResult() {
    // Given an SDK result ready for publication but not yet delivered.
    val slot = OcrSlot()
    slot.reserve("result")
    val ticket = slot.start("result")
    var published = false
    // When cancellation wins the publication gate.
    slot.cancel("result")
    // Then the caller cannot observe a successful page.
    assertThrows(IllegalStateException::class.java) { slot.publish(ticket) { published = true } }
    assertFalse(published)
    slot.finish(ticket)
  }
}
