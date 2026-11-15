function pcm24to16(input) {
    if (input.length % 6 !== 0) throw new Error('PCM chunk must contain a whole 24→16 kHz sample group');
    const output = Buffer.allocUnsafe((input.length * 2) / 3);
    for (let i = 0, o = 0; i < input.length; i += 6, o += 4) {
        output.writeInt16LE(input.readInt16LE(i), o);
        output.writeInt16LE(Math.round((input.readInt16LE(i + 2) + input.readInt16LE(i + 4)) / 2), o + 2);
    }
    return output;
}
function wav(pcm, sampleRate = 24000) {
    const header = Buffer.alloc(44);
    header.write('RIFF');
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]);
}
module.exports = { pcm24to16, wav };
