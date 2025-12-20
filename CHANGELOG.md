# Changelog

All notable changes to this project will be documented in this file.

---

## [2.0.0] - 2025-12-20

### 🎯 Major Features

#### Code Command Enhancements
- **Validation before save**: Now validates command files for syntax errors and duplicate names BEFORE writing
- **Proper reload by filename**: Loader now matches commands by filename in addition to config.name
- **Edit protection**: When editing, gets old file's actual config.name to avoid false duplicate errors
- **Rename fix**: Fixed rename to properly unload old command by its actual config.name before reload

#### Pastebin Apply Feature
- **New action**: Added `/pastebin apply <filepath>` to apply code from Pastebin URLs
- **Reply-based**: Reply to a message containing pastebin link and apply code directly
- **Full validation**: Uses same validation as code command (syntax + duplicate check)
- **Auto-reload**: Command automatically reloads after successful apply

#### YouTube URL Detection Fix
- **music command**: Fixed detection for YouTube Shorts, mobile links, embed URLs
- **video command**: Same fix applied - now handles all YouTube URL formats
- **URL normalization**: All URLs normalized to standard `youtube.com/watch?v=ID` format

### 🔧 Improvements

#### Loader Improvements (`utils/loader.js`)
- Added `validateCommand()` function for pre-save validation
- Cache clearing before require to ensure fresh file content
- Support for matching commands by filename (not just config.name)
- Better alias conflict detection

#### Logs Timezone
- **India Standard Time**: Logs now display time in IST (Asia/Kolkata) timezone
- Applied to both `main.js` and `handleCommand.js`

#### Dead Thread Cleanup
- Removed verbose debug logs from background cleanup
- Cleaner console output during cleanup operations

### 📁 Files Modified

| File | Change Type | Description |
|------|-------------|-------------|
| `modules/commands/code.js` | Enhanced | Validation, reload fixes |
| `modules/commands/pastebin.js` | Enhanced | Added apply action |
| `modules/commands/music.js` | Fixed | YouTube URL detection |
| `modules/commands/video.js` | Fixed | YouTube URL detection |
| `modules/commands/cleanup.js` | New | Manual cleanup DB threads command |
| `utils/loader.js` | Enhanced | validateCommand, filename matching |
| `handles/handleCreateDatabase.js` | Cleaned | Removed debug logs |
| `handles/handleCommand.js` | Updated | IST timezone |
| `main.js` | Updated | IST timezone |

---

## [1.0.0] - Initial Release

- Runtime update helper
- Stability fixes
- Bot command updates

---

### Legend
- 🎯 Major Features
- 🔧 Improvements
- 🐛 Bug Fixes
- 📁 File Changes
