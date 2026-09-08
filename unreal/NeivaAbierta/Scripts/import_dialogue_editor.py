#!/usr/bin/env python3
"""Validate dialogue sources and import SoundWave assets in UE 5.5 Editor.

Outside Editor: python import_dialogue_editor.py --check (no writes).
Editor: -ExecutePythonScript=/absolute/path/import_dialogue_editor.py
No playback/packaging claim: Saved/NeivaDialogue-import.json records import only.

APIs: SoundFactory.h (AudioEditor), SoundWave.h (Engine), and UE Python5.5
https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/SoundWave?application_version=5.5
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import tempfile
import wave

REPO = Path(__file__).resolve().parents[3]
MANIFEST = REPO / 'data/dialogue/neiva-dialogue.json'
DESTINATION = '/Game/NeivaAssets/Dialogue'
IDENTIFIER = re.compile(r'[a-z][a-z0-9_]*\Z')
SHA256 = re.compile(r'[0-9a-f]{64}\Z')
QUALITY = 60


def file_hash(path):
    """O(B) time, O(1) stream memory; hash actual source bytes, not metadata."""
    digest = hashlib.sha256()
    with Path(path).open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def validate_manifest(manifest=MANIFEST, repo=REPO):
    """O(B+C) time, O(C) metadata; validate all WAVs before any asset mutation."""
    manifest, repo = Path(manifest), Path(repo).resolve()
    data = json.loads(manifest.read_text(encoding='utf-8'))
    if not isinstance(data, dict) or type(data.get('schemaVersion')) is not int or data['schemaVersion'] != 1:
        raise ValueError('Dialogue manifest requires schemaVersion: 1.')
    clips = data.get('clips')
    if not isinstance(clips, list) or not clips:
        raise ValueError('Dialogue clips must be a non-empty array.')
    audio_root = (repo / 'public/audio/dialogue').resolve()
    ids, validated = set(), []
    for clip in clips:
        if not isinstance(clip, dict):
            raise ValueError('Each dialogue clip must be an object.')
        clip_id = clip.get('id')
        if not isinstance(clip_id, str) or not IDENTIFIER.fullmatch(clip_id) or clip_id in ids:
            raise ValueError(f'Invalid or duplicate clip id: {clip_id!r}')
        ids.add(clip_id)
        if clip.get('file') != f'/audio/dialogue/{clip_id}.wav':
            raise ValueError(f'{clip_id}: file must match /audio/dialogue/<id>.wav.')
        expected_hash = clip.get('sha256')
        if not isinstance(expected_hash, str) or not SHA256.fullmatch(expected_hash):
            raise ValueError(f'{clip_id}: invalid SHA-256.')
        if not isinstance(clip.get('text'), str) or not clip['text'].strip():
            raise ValueError(f'{clip_id}: missing spoken text.')
        source = (repo / 'public' / clip['file'].lstrip('/')).resolve()
        if not source.is_relative_to(audio_root) or not source.is_file():
            raise ValueError(f'{clip_id}: WAV missing or outside dialogue directory.')
        if file_hash(source) != expected_hash:
            raise ValueError(f'{clip_id}: WAV SHA-256 mismatch.')
        try:
            with wave.open(str(source), 'rb') as wav:
                if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getcomptype()) != (1, 2, 22050, 'NONE'):
                    raise ValueError(f'{clip_id}: requires mono PCM16 WAV at 22050 Hz.')
                frames = wav.getnframes()
                actual = 0
                while block := wav.readframes(65536):
                    actual += len(block)
                if frames <= 0 or actual != frames * 2:
                    raise ValueError(f'{clip_id}: empty or truncated PCM data.')
        except (wave.Error, EOFError) as error:
            raise ValueError(f'{clip_id}: invalid WAV ({error}).') from error
        validated.append({'id': clip_id, 'file': clip['file'], 'source': source,
                          'sha256': expected_hash, 'frames': frames, 'seconds': frames / 22050,
                          'text': clip['text'], 'asset': f'{DESTINATION}/VO_{clip_id}.VO_{clip_id}'})
    roles, topics = data.get('roles'), data.get('topics')
    if not isinstance(roles, dict) or not roles or not isinstance(topics, list) or not topics:
        raise ValueError('Dialogue requires non-empty roles and topics.')
    for role_id, role in roles.items():
        if not IDENTIFIER.fullmatch(role_id) or not isinstance(role, dict) or role.get('greeting') not in ids or not str(role.get('label', '')).strip():
            raise ValueError(f'Invalid role or greeting reference: {role_id!r}')
    topic_ids = set()
    for topic in topics:
        if not isinstance(topic, dict):
            raise ValueError('Each topic must be an object.')
        key = topic.get('key')
        if not isinstance(key, str) or not IDENTIFIER.fullmatch(key) or key in topic_ids or topic.get('clip') not in ids or not str(topic.get('label', '')).strip():
            raise ValueError(f'Invalid topic or clip reference: {key!r}')
        topic_ids.add(key)
    readme = audio_root / 'README.md'
    if not readme.resolve().is_relative_to(audio_root) or not readme.is_file() or not readme.read_text(encoding='utf-8').strip():
        raise ValueError('Dialogue README.md credits are missing.')
    model_card = audio_root / 'MODEL_CARD'
    voice = data.get('voice')
    card_hash = voice.get('modelCardSha256') if isinstance(voice, dict) else None
    if not isinstance(card_hash, str) or not SHA256.fullmatch(card_hash):
        raise ValueError('Dialogue voice.modelCardSha256 is missing or invalid.')
    if (not model_card.resolve().is_relative_to(audio_root) or not model_card.is_file()
            or model_card.stat().st_size == 0):
        raise ValueError('Dialogue MODEL_CARD credits are missing or outside dialogue directory.')
    if file_hash(model_card) != card_hash:
        raise ValueError('Dialogue MODEL_CARD SHA-256 mismatch.')
    return data, validated, readme, model_card


def atomic_write(path, content):
    """O(B) time/bytes; atomically replace this generated output only."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.' + path.name, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(content)
        temporary.replace(path)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()


def import_clip(u, clip, project_content):
    """Idempotent named import; verify class/format and force-save actual asset."""
    editor = u.EditorAssetLibrary
    name = 'VO_' + clip['id']
    package_path = f'{DESTINATION}/{name}'
    sound = editor.load_asset(package_path) if editor.does_asset_exist(package_path) else None
    if sound is not None and not isinstance(sound, u.SoundWave):
        raise RuntimeError(f'{clip["id"]}: target exists but is not a SoundWave.')
    reused = sound is not None and editor.get_metadata_tag(sound, 'NeivaDialogueSHA256') == clip['sha256']
    if not reused:
        factory = u.SoundFactory()
        factory.set_editor_property('auto_create_cue', False)
        task = u.AssetImportTask()
        for key, value in {'filename': str(clip['source']), 'destination_path': DESTINATION,
                           'destination_name': name, 'automated': True, 'replace_existing': True,
                           'replace_existing_settings': True, 'save': False, 'factory': factory}.items():
            task.set_editor_property(key, value)
        u.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
        imported = list(task.get_editor_property('imported_object_paths'))
        if clip['asset'] not in imported:
            raise RuntimeError(f'{clip["id"]}: import returned no expected SoundWave; paths={imported}.')
        sound = editor.load_asset(package_path)
    if not isinstance(sound, u.SoundWave):
        raise RuntimeError(f'{clip["id"]}: SoundWave was not imported.')
    sound.modify(True)
    sound.set_editor_property('looping', False)
    sound.set_editor_property('compression_quality', QUALITY)
    sound.set_sound_asset_compression_type(u.SoundAssetCompressionType.BINK_AUDIO, True)
    if (sound.get_editor_property('looping') or sound.get_editor_property('compression_quality') != QUALITY
            or sound.get_sound_asset_compression_type() != u.SoundAssetCompressionType.BINK_AUDIO):
        raise RuntimeError(f'{clip["id"]}: compression or looping settings were not applied.')
    editor.set_metadata_tag(sound, 'NeivaDialogueSHA256', clip['sha256'])
    editor.set_metadata_tag(sound, 'NeivaDialogueText', clip['text'])
    if sound.get_editor_property('imported_sample_rate') != 22050 or sound.get_editor_property('num_channels') != 1:
        raise RuntimeError(f'{clip["id"]}: imported channel count/sample rate differs.')
    duration = float(sound.get_editor_property('duration'))
    if abs(duration - clip['seconds']) > 0.002:
        raise RuntimeError(f'{clip["id"]}: imported duration differs from WAV.')
    if not editor.save_loaded_asset(sound, only_if_is_dirty=False):
        raise RuntimeError(f'{clip["id"]}: saving SoundWave failed.')
    saved_file = project_content / 'NeivaAssets/Dialogue' / (name + '.uasset')
    if not saved_file.is_file() or saved_file.stat().st_size == 0:
        raise RuntimeError(f'{clip["id"]}: saved .uasset is missing or empty.')
    return {'id': clip['id'], 'asset': sound.get_path_name(), 'sha256': clip['sha256'],
            'sourceFrames': clip['frames'], 'durationSeconds': duration, 'reused': reused,
            'looping': bool(sound.get_editor_property('looping')), 'compressionQuality': QUALITY,
            'compression': 'BinkAudio', 'assetBytes': saved_file.stat().st_size}


def main(check_only=False):
    if check_only:
        _, clips, _, _ = validate_manifest()
        print(json.dumps({'sourcesValid': True, 'engineImportPassed': False, 'clips': len(clips),
                          'seconds': sum(c['seconds'] for c in clips)}, indent=2))
        return
    import unreal as u
    report_path = Path(u.Paths.project_saved_dir()).resolve() / 'NeivaDialogue-import.json'
    content_dir = Path(u.Paths.project_content_dir()).resolve()
    if content_dir != (REPO / 'unreal/NeivaAbierta/Content').resolve():
        raise RuntimeError('Open the NeivaAbierta project before importing its dialogue assets.')
    report = {'schemaVersion': 1, 'status': 'running', 'engineImportPassed': False,
              'runtimePlaybackPassed': False, 'startedAtUtc': datetime.now(timezone.utc).isoformat(),
              'clips': [], 'errors': []}
    def save_report():
        atomic_write(report_path, (json.dumps(report, indent=2, ensure_ascii=False) + '\n').encode('utf-8'))
    save_report()  # A fresh failure cannot leave a stale PASS report.
    try:
        _, clips, readme, model_card = validate_manifest()
        manifest_bytes = MANIFEST.read_bytes()
        for clip in clips:
            try:
                report['clips'].append(import_clip(u, clip, content_dir))
            except Exception as error:
                report['errors'].append({'id': clip['id'], 'error': str(error)})
        if report['errors']:
            raise RuntimeError(f'{len(report["errors"])} dialogue clip(s) failed; runtime JSON not staged.')
        u.SystemLibrary.execute_console_command(None, 'Editor.AsyncAssetCompilationFinishAll')
        if not u.EditorAssetLibrary.save_directory(DESTINATION, only_if_is_dirty=False, recursive=True):
            raise RuntimeError('Final dialogue asset save failed.')
        # Runtime data and credits are installed only after all SoundWaves succeed.
        atomic_write(content_dir / 'Data/neiva-dialogue.json', manifest_bytes)
        atomic_write(content_dir / 'Data/Licenses/dialogue/README.md', readme.read_bytes())
        atomic_write(content_dir / 'Data/Licenses/dialogue/MODEL_CARD', model_card.read_bytes())
        report.update(status='PASS', engineImportPassed=True,
                      completedAtUtc=datetime.now(timezone.utc).isoformat(),
                      manifestSHA256=hashlib.sha256(manifest_bytes).hexdigest(),
                      creditsSHA256=file_hash(readme), modelCardSHA256=file_hash(model_card))
    except Exception as error:
        report['status'] = 'FAIL'
        report['errors'].append({'stage': 'import', 'error': str(error)})
        u.log_error('Neiva dialogue import failed: ' + str(error))
        raise
    finally:
        save_report()
    u.log('Neiva dialogue SoundWaves saved. Playback and cook require separate validation.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Validate source WAV/JSON only; no Unreal imports or writes.')
    args, _ = parser.parse_known_args()
    main(args.check)
