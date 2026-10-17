export function setupFullscreen({ message, changed }) {
  const root = document.documentElement;
  const buttons = [...document.querySelectorAll('[data-fullscreen]')];
  const active = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  const sync = () => {
    const label = active() ? '退出全屏' : '进入全屏';
    for (const button of buttons) {
      button.title = label; button.setAttribute('aria-label', label);
      button.setAttribute('aria-pressed', String(active()));
      button.innerHTML = `<i data-lucide="${active() ? 'minimize' : 'maximize'}"></i>`;
    }
    window.lucide?.createIcons();
    changed();
  };
  const lockLandscape = () => {
    if (matchMedia('(pointer:coarse)').matches) screen.orientation?.lock?.('landscape').catch(() => {});
  };
  async function toggle() {
    try {
      if (active()) {
        const leave = document.exitFullscreen || document.webkitExitFullscreen;
        if (leave) await leave.call(document);
        screen.orientation?.unlock?.();
      } else {
        const enter = root.requestFullscreen || root.webkitRequestFullscreen;
        if (!enter) {
          message('此浏览器不支持网页全屏。可用系统浏览器打开；iPhone 可从 Safari 添加到主屏幕后启动。');
          return;
        }
        // Invoke directly inside the click gesture, before any other asynchronous work.
        await enter.call(root, { navigationUI: 'hide' });
        lockLandscape();
      }
      sync();
    } catch {
      message('浏览器未允许全屏，请在系统浏览器中打开后再试。');
      sync();
    }
  }
  for (const button of buttons) button.addEventListener('click', toggle);
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);
  sync();
}
