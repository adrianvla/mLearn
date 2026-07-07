/**
 * Mic capture AudioWorklet processor.
 * Receives mono Float32 audio from the mic source, buffers to a configurable
 * chunk size (default 4096 samples = 256ms at 16kHz), and posts buffered chunks
 * to the main thread as Float32Array via transferable buffers.
 *
 * Handles sample-rate mismatch: if the AudioContext runs at a different rate
 * than the target 16kHz (browser may ignore the sampleRate constraint),
 * performs linear-interpolation resampling before posting.
 *
 * Main thread sends:
 *   { type: 'configure', bufferSize: number, outputSampleRate: number }
 *   { type: 'flush' }
 *
 * Worklet posts:
 *   { type: 'audio', samples: Float32Array, sampleRate: number }
 */
class AudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._bufferSize = (options.processorOptions && options.processorOptions.bufferSize) || 4096;
    this._outputSampleRate = (options.processorOptions && options.processorOptions.outputSampleRate) || 16000;
    this._inputSampleRate = sampleRate; // global in AudioWorkletGlobalScope
    this._buffer = new Float32Array(this._bufferSize);
    this._offset = 0;

    this.port.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === 'configure') {
        if (msg.bufferSize) this._bufferSize = msg.bufferSize;
        if (msg.outputSampleRate) this._outputSampleRate = msg.outputSampleRate;
        this._buffer = new Float32Array(this._bufferSize);
        this._offset = 0;
      } else if (msg.type === 'flush') {
        this._emit();
      }
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) {
      return true; // keep alive even with no input (mic not ready yet)
    }

    const channel = input[0]; // Float32Array(128) — mono

    for (let i = 0; i < channel.length; i++) {
      this._buffer[this._offset++] = channel[i];
      if (this._offset >= this._bufferSize) {
        this._emit();
      }
    }

    return true;
  }

  _emit() {
    if (this._offset === 0) return;

    // Extract the filled portion
    const chunk = this._buffer.subarray(0, this._offset);
    this._offset = 0;

    // Resample if the AudioContext rate doesn't match our target
    let output;
    if (this._inputSampleRate === this._outputSampleRate) {
      output = new Float32Array(chunk.length);
      output.set(chunk);
    } else {
      output = this._resample(chunk, this._inputSampleRate, this._outputSampleRate);
    }

    // Transfer the buffer (zero-copy to main thread)
    this.port.postMessage(
      { type: 'audio', samples: output, sampleRate: this._outputSampleRate },
      [output.buffer]
    );
  }

  _resample(input, fromRate, toRate) {
    const ratio = fromRate / toRate;
    const outputLength = Math.round(input.length / ratio);
    const output = new Float32Array(outputLength);
    for (let i = 0; i < outputLength; i++) {
      const pos = i * ratio;
      const idx = Math.floor(pos);
      const frac = pos - idx;
      const a = input[idx] || 0;
      const b = input[Math.min(idx + 1, input.length - 1)] || 0;
      output[i] = a + frac * (b - a);
    }
    return output;
  }
}

registerProcessor('audio-processor', AudioProcessor);
