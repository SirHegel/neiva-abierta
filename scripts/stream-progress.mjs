// RTP progress is evidence of decoded video, never proof of native gameplay.
export function decodedBetween(earlier, later) {
  return later.incoming.flatMap(current => {
    const prior = earlier.incoming.find(previous => previous.id === current.id);
    const frames = current.framesDecoded - prior?.framesDecoded;
    const bytes = current.bytesReceived - prior?.bytesReceived;
    return Number.isFinite(frames) && frames > 0 && Number.isFinite(bytes) && bytes > 0
      ? [{id: current.id, frames, bytes}] : [];
  });
}

export function inputReadiness(earlier, later) {
  const streams = decodedBetween(earlier, later);
  const newFrames = streams.reduce((sum, stream) => sum + stream.frames, 0);
  const newBytes = streams.reduce((sum, stream) => sum + stream.bytes, 0);
  return {newFrames, newBytes, ready: later.connection === 'connected' &&
    later.width > 0 && later.height > 0 && newFrames >= 3 && newBytes > 0};
}
