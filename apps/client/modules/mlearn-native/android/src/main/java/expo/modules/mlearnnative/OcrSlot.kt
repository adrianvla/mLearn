package expo.modules.mlearnnative

import java.util.concurrent.atomic.AtomicBoolean

// The slot remains occupied after cancellation once work starts. In particular,
// coroutine cancellation cannot release an image still consumed by ML Kit.
internal class OcrSlot {
  class Ticket(val id: String, val runtimeRequest: Boolean) {
    val cancelled = AtomicBoolean(false)
    var started = false
  }
  private var active: Ticket? = null
  private var closed = false

  @Synchronized fun reserve(id: String, runtimeRequest: Boolean = true): Ticket {
    require(id.isNotEmpty() && id.length <= 256) { "Invalid OCR request identity." }
    check(!closed && active == null) { "OCR is busy or the module was destroyed." }
    return Ticket(id, runtimeRequest).also { active = it }
  }

  @Synchronized fun start(id: String): Ticket {
    val ticket = active
    check(!closed && ticket != null && ticket.id == id && !ticket.started && !ticket.cancelled.get()) {
      "OCR request is not reserved or was cancelled."
    }
    ticket.started = true
    return ticket
  }

  fun check(ticket: Ticket) {
    check(!ticket.cancelled.get()) { "OCR request cancelled." }
  }

  @Synchronized fun cancel(id: String) {
    active?.takeIf { it.id == id }?.let {
      it.cancelled.set(true)
      if (!it.started) active = null
    }
  }

  @Synchronized fun finish(ticket: Ticket) {
    if (active === ticket) active = null
  }

  @Synchronized fun publish(ticket: Ticket, publish: () -> Unit) {
    check(active === ticket && !closed && !ticket.cancelled.get()) { "OCR publication cancelled." }
    publish()
  }

  @Synchronized fun close(): String? {
    closed = true
    return active?.let { cancel(it.id); if (it.runtimeRequest) it.id else null }
  }
}
