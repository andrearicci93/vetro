# Launcher designer

`index.html` is a standalone page (no server, no dependencies) to try out the look of the launcher:
position, size, shell, icons, focus glow, labels, pills, motion, plus ready-made styles to compare.
Every option is tagged with how well the native launcher can reproduce it.

It shows placeholder icons. To see your own apps, put an `icons.js` next to it:

```js
window.DESIGNER_APPS = [{slug: 'netflix', label: 'Netflix', icon: 'data:image/png;base64,...'}, ...];
```

(`icons.js` is personal and not committed.) The result is a JSON block at the bottom of the page.
