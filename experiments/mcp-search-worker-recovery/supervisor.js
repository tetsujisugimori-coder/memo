/* Research-only: synthetic sessions are NOT OAuth authorization. Not loaded by the app. */
(function (root) {
  'use strict';
  class RecoverySupervisor {
    constructor({ createWorker, now = () => Date.now(), monotonicNow = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout }) {
      this.createWorker = createWorker; this.now = now; this.monotonicNow = monotonicNow; this.setTimer = setTimer; this.clearTimer = clearTimer;
      this.created = 0; this.quarantined = 0; this.sequence = 0; this.session = null;
      this.worker = null; this.pending = null; this.generation = 0; this.closed = false;
    }
    status() {
      return { created: this.created, quarantined: this.quarantined, pending: Boolean(this.pending),
        state: this.closed ? 'CLOSED' : !this.worker && this.created >= 2 ? 'STOPPED_RESOURCE_UNCONFIRMED' : 'AVAILABLE',
        resourceRelease: 'UNKNOWN', recovery: 'No automatic reset. Separate browser lifecycle and explicit reauthorization required; release remains unproven.' };
    }
    authorize(session) {
      if (this.closed) throw new Error('closed');
      if (!session || typeof session.id !== 'string' || !session.id || !Number.isFinite(session.expiresAt) || session.expiresAt <= this.now()) throw new Error('invalid_session');
      this.cancel('session_replaced'); this.generation++;
      this.session = Object.freeze({ id: session.id, expiresAt: session.expiresAt, allowRead: session.allowRead === true });
    }
    execute({ operation, query = '', id = '', timeoutMs = 1000, mode = 'normal' }) {
      if (this.closed) return Promise.reject(new Error('closed'));
      if (!this.session || this.now() >= this.session.expiresAt) return Promise.reject(new Error('expired_or_cancelled'));
      if (!['search', 'read'].includes(operation) || operation === 'read' && !this.session.allowRead) return Promise.reject(new Error('not_allowed'));
      if (this.pending) return Promise.reject(new Error('busy'));
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 6000) return Promise.reject(new Error('invalid_timeout'));
      if (this.sequence >= 100) return Promise.reject(new Error('request_budget'));
      if (!this.worker) {
        if (this.created >= 2) return Promise.reject(new Error('resource_release_unconfirmed'));
        this.created++; // Even failed construction consumes a lifetime attempt; never refund.
        try { this.worker = this.createWorker(); } catch { this.quarantined++; return Promise.reject(new Error('worker_creation_failed')); }
      }
      const worker = this.worker, session = this.session;
      const token = { workerId: this.created, generation: this.generation, requestId: ++this.sequence, session: session.id };
      return new Promise((resolve, reject) => {
        const entry = { worker, token, session, resolve, reject, deadline: this.monotonicNow() + timeoutMs };
        this.pending = entry;
        entry.timer = this.setTimer(() => { if (this.pending === entry) this.stop(entry, this.now() >= session.expiresAt ? 'expired' : 'timeout'); }, Math.max(0, Math.min(timeoutMs, session.expiresAt - this.now())));
        worker.onmessage = ({ data }) => this.receive(entry, data);
        worker.onerror = () => { if (this.pending === entry) this.stop(entry, 'worker_error'); };
        try { worker.postMessage({ ...token, operation, query, id, mode }); }
        catch { this.stop(entry, 'post_failed'); }
      });
    }
    receive(entry, data) {
      if (this.pending !== entry || this.session !== entry.session || this.closed) return false;
      if (this.now() >= entry.session.expiresAt || this.monotonicNow() >= entry.deadline) { this.stop(entry, 'expired_or_timeout'); return false; }
      if (!data || Object.keys(entry.token).some(key => data[key] !== entry.token[key])) return false;
      if (data.phase !== 'complete' || data.transaction !== 'complete' || data.closeRequested !== true || !Array.isArray(data.result)) return false;
      this.pending = null; this.clearTimer(entry.timer);
      entry.worker.onmessage = null; entry.worker.onerror = null;
      entry.resolve(data.result); return true;
    }
    stop(entry, reason) {
      if (this.pending !== entry) return;
      this.pending = null; this.clearTimer(entry.timer);
      this.worker = null; this.quarantined++; // terminate returning does not release this debt.
      entry.worker.onmessage = null; entry.worker.onerror = null;
      try { entry.worker.terminate(); } catch { /* Debt and rejection persist. */ }
      entry.reject(new Error(reason));
    }
    cancel(reason = 'cancelled') {
      this.session = null;
      if (this.pending) this.stop(this.pending, reason);
    }
    close() {
      this.cancel('closed'); this.closed = true;
      if (this.worker) { const worker = this.worker; this.worker = null; this.quarantined++; try { worker.terminate(); } catch {} }
    }
  }
  if (typeof module !== 'undefined') module.exports = { RecoverySupervisor };
  else root.RecoverySupervisor = RecoverySupervisor;
})(globalThis);
