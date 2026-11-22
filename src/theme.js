// Follow the OS light/dark setting (Bootstrap color modes). Loaded in <head> to avoid a flash.
document.documentElement.dataset.bsTheme =
  matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
