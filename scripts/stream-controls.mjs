// Input delivery plans are not assertions about Unreal's gameplay state.
export function validateInteractionModes({controls, drive, exercise, fixture, record, seconds}) {
  if ([controls, drive, exercise].filter(Boolean).length > 1)
    throw Error('--controls, --drive and --exercise are mutually exclusive.');
  if (controls && fixture) throw Error('--controls requires the native game, not a fixture.');
  if (drive && record && seconds > 45)
    throw Error('--drive --record requires seconds <=45 to include the input sequence within the 60 s recording limit.');
  if (controls && record && seconds > 20)
    throw Error('--controls --record requires seconds <=20 to reserve time for native state queries within the 60 s recording limit.');
}

export function nativeControlsPlan() {
  const key = (key, milliseconds, label) => ({type: 'key', key, milliseconds, label});
  const wait = milliseconds => ({type: 'wait', milliseconds});
  const state = name => ({type: 'native-state', name});
  const mouse = (x, y, name) => ({type: 'mouse', x, y, name, buttons: 0});
  const pause = name => [
    key('p', 60, `${name}:pause-P`), wait(350), state(`${name}-paused`),
    key('w', 700, `${name}:W-while-paused:700ms`), wait(350), state(`${name}-paused-after-input`),
    key('p', 60, `${name}:resume-P`), wait(500), state(`${name}-resumed`),
  ];
  return [
    // Reach the car before any mouse motion changes the known initial yaw.
    key('w', 3000, 'W:3000ms'), wait(300),
    mouse(640, 360, 'foot-pointer-position'), wait(250), state('foot-before-look'),
    mouse(800, 360, 'foot-look-right-no-buttons'), wait(350), state('foot-after-look'),
    ...pause('foot'),
    key('e', 60, 'car:enter-E'), wait(600), state('car-before-look'),
    mouse(960, 360, 'car-look-right-no-buttons'), wait(350), state('car-after-look'),
    ...pause('car'),
    key('e', 60, 'car:exit-E'), wait(600), state('foot-after-car-exit'),
  ];
}
