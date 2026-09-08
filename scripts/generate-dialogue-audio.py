#!/usr/bin/env python3
"""Render the original dialogue offline with an operator-supplied Piper voice.

Piper and the ONNX voice stay outside the game. Only PCM WAV, text and source
attribution are staged. Run in the dedicated Piper virtual environment.
"""
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import wave


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--voice', type=Path, required=True)
    parser.add_argument('--model-card', type=Path, required=True)
    parser.add_argument('--source-url', required=True)
    args = parser.parse_args()
    from piper import PiperVoice, SynthesisConfig
    repo = Path(__file__).resolve().parents[1]
    manifest = repo / 'data/dialogue/neiva-dialogue.json'
    data = json.loads(manifest.read_text())
    voice = PiperVoice.load(str(args.voice), use_cuda=False)
    output = repo / 'public/audio/dialogue'
    output.mkdir(parents=True, exist_ok=True)
    config = SynthesisConfig(length_scale=1.05, noise_scale=0.45,
                             noise_w_scale=0.65, volume=0.8)
    for clip in data['clips']:
        if not clip['id'].isascii() or not clip['id'].replace('_', '').isalnum():
            raise ValueError('Invalid dialogue id')
        path = output / (clip['id'] + '.wav')
        if clip['file'] != '/audio/dialogue/' + path.name:
            raise ValueError('Unexpected dialogue audio path')
        temporary = path.with_suffix('.wav.part')
        with wave.open(str(temporary), 'wb') as wav:
            voice.synthesize_wav(clip['text'], wav, syn_config=config)
        with wave.open(str(temporary), 'rb') as wav:
            assert (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) == (1, 2, 22050)
            clip['durationSeconds'] = wav.getnframes() / wav.getframerate()
            assert 0 < clip['durationSeconds'] < 40
        os.replace(temporary, path)
        clip['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
        clip['bytes'] = path.stat().st_size
        print(clip['id'], round(clip['durationSeconds'], 2), clip['sha256'], flush=True)
    data['voice'] = {
        'synthetic': True, 'engine': 'Piper',
        'engineVersion': importlib.metadata.version('piper-tts'),
        'model': 'es_MX-ald-medium', 'sourceUrl': args.source_url,
        'modelSha256': hashlib.sha256(args.voice.read_bytes()).hexdigest(),
        'modelCardSha256': hashlib.sha256(args.model_card.read_bytes()).hexdigest(),
        'datasetLicense': 'Unlicense (model card); see README and MODEL_CARD',
        'runtimeIncluded': False, 'modelIncluded': False,
        'note': 'Spanish synthetic voice, not a recording of a real Neiva resident. No lip-sync claim.'
    }
    (output / 'MODEL_CARD').write_bytes(args.model_card.read_bytes())
    manifest.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()
