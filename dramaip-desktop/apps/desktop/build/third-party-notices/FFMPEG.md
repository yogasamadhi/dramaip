# FFmpeg runtime notice

This application distributes the `ffmpeg-static` runtime package (pinned in
the application lockfile) to provide local MP4 rendering without requiring a
separate user installation. The package supplies FFmpeg builds and is
maintained at https://github.com/eugeneware/ffmpeg-static.

FFmpeg is licensed under LGPL-2.1-or-later or GPL-2.0-or-later depending on
the enabled configuration. This application uses H.264/x264 rendering and
therefore treats the bundled runtime as GPL-capable. Before redistributing a
branded build, release engineering must preserve the upstream FFmpeg notices,
provide the corresponding source/configuration offer required by the selected
binary, and verify the destination platform's binary and signing requirements.

The application invokes FFmpeg as a separate local process. It does not upload
project media or subtitle contents to a rendering service.
