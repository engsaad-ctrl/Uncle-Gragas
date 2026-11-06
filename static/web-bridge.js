// In a browser (the phone page) there is no preload: the same calls go to the app over HTTP. In the app's own F7
// window the preload has already set window.lolh, and this does nothing.
if (!window.lolh) {
  const call = (channel) => async (...args) => {
    const r = await fetch(`/ipc/${channel}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) });
    if (!r.ok) return { error: r.status === 403 ? 'افتح الرابط من إعدادات البرنامج من جديد.' : `الخادم ردّ ${r.status}` };
    return r.json();
  };
  const fail = (channel) => (...args) => call(channel)(...args).catch(() => ({ error: 'البرنامج على الكمبيوتر غير متصل.' }));
  document.documentElement.classList.add('web');
  // A phone screen: the small layout, unless already chosen on this phone.
  try {
    if (innerWidth < 700 && !localStorage.getItem('overlayLarge')) localStorage.setItem('overlayLarge', 'normal');
  } catch {
    // storage unavailable: keep the default
  }
  window.lolh = {
    overlayData: fail('overlay:data'),
    aiBuild: fail('ai:build'),
    lastAiPicks: () => call('ai:last')().catch(() => null),
    augmentFit: fail('mayhem:fit'),
    augmentEffects: fail('mayhem:effects'),
    openAugments: fail('mayhem:open'),
    listItems: fail('items:list'),
    listChampions: fail('champions:list'),
    gameTeams: fail('game:teams'),
    engineBuild: fail('build:engine'),
    stackBase: fail('build:stackBase'),
    buildStyles: fail('build:styles'),
    cardValues: fail('build:cardvalues'),
    experimentalBuild: fail('build:experimental'),
    hideOverlay: async () => undefined,
    setOverlayLarge: async () => undefined,
    // Coming back to the page is the phone's F7 press: read the current champion again.
    onOverlayShow: (callback) => document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && callback()),
  };
}
