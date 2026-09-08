"""Validate actual PCM fixtures; these tests do not impersonate an Unreal import."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import wave

SPEC = importlib.util.spec_from_file_location('dialogue_import', Path(__file__).resolve().parents[1] / 'import_dialogue_editor.py')
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class DialogueSourceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name)
        self.audio = self.repo / 'public/audio/dialogue'
        self.audio.mkdir(parents=True)
        self.wav = self.audio / 'hola.wav'
        self.write_wav()
        (self.audio / 'README.md').write_text('Synthetic PCM fixture. No recorded or synthesized voice.', encoding='utf-8')
        self.card = self.audio / 'MODEL_CARD'
        self.card.write_text('Synthetic test model card. No speech model included.', encoding='utf-8')
        self.manifest = self.repo / 'dialogue.json'
        self.data = {'schemaVersion': 1, 'clips': [{'id': 'hola', 'file': '/audio/dialogue/hola.wav',
                     'sha256': module.file_hash(self.wav), 'text': 'Texto de prueba.'}],
                     'roles': {'vecino': {'label': 'Vecino', 'greeting': 'hola'}},
                     'topics': [{'key': 'ciudad', 'label': 'Ciudad', 'clip': 'hola'}],
                     'voice': {'modelCardSha256': module.file_hash(self.card)}}
        self.save()

    def write_wav(self, channels=1, width=2, rate=22050, frames=2205):
        with wave.open(str(self.wav), 'wb') as f:
            f.setnchannels(channels)
            f.setsampwidth(width)
            f.setframerate(rate)
            f.writeframes(bytes(frames * channels * width))

    def save(self):
        self.manifest.write_text(json.dumps(self.data), encoding='utf-8')

    def check(self):
        return module.validate_manifest(self.manifest, self.repo)

    def update_hash(self):
        self.data['clips'][0]['sha256'] = module.file_hash(self.wav)
        self.save()

    def test_valid_pcm_keeps_identity_frames_and_source_unchanged(self):
        before = self.manifest.read_bytes(), self.wav.read_bytes()
        data, clips, readme, model_card = self.check()
        self.assertEqual(data, self.data)
        self.assertEqual(clips[0]['asset'], '/Game/NeivaAssets/Dialogue/VO_hola.VO_hola')
        self.assertEqual(clips[0]['frames'], 2205)
        self.assertAlmostEqual(clips[0]['seconds'], .1)
        self.assertEqual(readme, self.audio / 'README.md')
        self.assertEqual(model_card, self.card)
        self.assertEqual(before, (self.manifest.read_bytes(), self.wav.read_bytes()))
        self.assertFalse((self.repo / 'unreal').exists())

    def test_altered_bytes_and_truncated_payload_fail_separately(self):
        self.wav.write_bytes(self.wav.read_bytes()[:-8])
        with self.assertRaisesRegex(ValueError, 'SHA-256 mismatch'):
            self.check()
        self.update_hash()
        with self.assertRaisesRegex(ValueError, 'truncated PCM'):
            self.check()

    def test_header_format_and_empty_audio_are_rejected_with_matching_hash(self):
        for options in [{'channels': 2}, {'width': 1}, {'rate': 16000}, {'frames': 0}]:
            with self.subTest(options=options):
                self.write_wav(**options)
                self.update_hash()
                with self.assertRaises(ValueError):
                    self.check()

    def test_duplicates_broken_references_and_unsafe_filename_fail(self):
        original = json.loads(json.dumps(self.data))
        for mutate in [
            lambda d: d['clips'].append(dict(d['clips'][0])),
            lambda d: d['roles']['vecino'].update(greeting='missing'),
            lambda d: d['topics'][0].update(clip='missing'),
            lambda d: d['topics'].append(dict(d['topics'][0])),
            lambda d: d['clips'][0].update(file='/audio/dialogue/../../private.wav'),
            lambda d: d.update(schemaVersion=True),
        ]:
            self.data = json.loads(json.dumps(original))
            mutate(self.data)
            self.save()
            with self.assertRaises(ValueError):
                self.check()

    def test_symlink_escape_and_missing_credits_do_not_stage_any_runtime_file(self):
        outside = self.repo / 'outside.wav'
        self.wav.replace(outside)
        self.wav.symlink_to(outside)
        with self.assertRaisesRegex(ValueError, 'outside dialogue directory'):
            self.check()
        self.wav.unlink()
        outside.replace(self.wav)
        (self.audio / 'README.md').unlink()
        with self.assertRaisesRegex(ValueError, 'credits'):
            self.check()
        self.assertFalse((self.repo / 'unreal').exists())

    def test_model_card_hash_presence_and_location_are_required(self):
        original = self.card.read_bytes()
        self.card.write_bytes(original + b' changed')
        with self.assertRaisesRegex(ValueError, 'MODEL_CARD SHA-256 mismatch'):
            self.check()
        self.card.unlink()
        with self.assertRaisesRegex(ValueError, 'MODEL_CARD credits are missing'):
            self.check()
        outside = self.repo / 'outside-card'
        outside.write_bytes(original)
        self.card.symlink_to(outside)
        with self.assertRaisesRegex(ValueError, 'outside dialogue directory'):
            self.check()
        self.card.unlink()
        self.card.write_bytes(original)
        self.data['voice'].pop('modelCardSha256')
        self.save()
        with self.assertRaisesRegex(ValueError, 'modelCardSha256 is missing'):
            self.check()


if __name__ == '__main__':
    unittest.main()
