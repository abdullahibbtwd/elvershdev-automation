import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FFMPEG_DEFAULT_TIMEOUT_MS,
  type SubtitleCue,
  type SubtitleStyle,
  type VideoOutputProfile,
} from '@ai-video/shared';
import { prepareSubtitleOverlays, writeSubtitleOverlayInputs } from './subtitle-burn';

export interface FfmpegRunOptions {
  args: string[];
  timeoutMs?: number;
  cwd?: string;
  onProgress?: (progress: { outTimeMs?: number; frame?: number }) => void;
  signal?: AbortSignal;
}

export interface FfmpegRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ProbeMediaResult {
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  sampleRate: number | null;
  channels: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
  formatName: string | null;
  fileSize: number | null;
  raw: Record<string, unknown>;
}

function parseFrameRate(rate: string | undefined): number | null {
  if (!rate) return null;
  if (rate.includes('/')) {
    const [num, den] = rate.split('/').map((part) => Number.parseFloat(part));
    if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) {
      return Number((num / den).toFixed(3));
    }
    return null;
  }
  const value = Number.parseFloat(rate);
  return Number.isFinite(value) ? value : null;
}

function escapeFilterPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

/** Process-wide registry so shutdown can SIGKILL in-flight FFmpeg/FFprobe children. */
const globalActiveProcesses = new Set<ChildProcessWithoutNullStreams>();

export class FfmpegService {
  private activeProcesses = new Set<ChildProcessWithoutNullStreams>();

  constructor(
    private readonly ffmpegPath = process.env.FFMPEG_PATH ?? 'ffmpeg',
    private readonly ffprobePath = process.env.FFPROBE_PATH ?? 'ffprobe',
  ) {}

  static killAllProcesses(): void {
    for (const child of globalActiveProcesses) {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
    }
    globalActiveProcesses.clear();
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.run({ args: ['-version'], timeoutMs: 5_000 });
      await this.runBinary(this.ffprobePath, { args: ['-version'], timeoutMs: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  async getVersion(): Promise<{ ffmpeg: string; ffprobe: string }> {
    const ffmpeg = await this.run({ args: ['-version'], timeoutMs: 5_000 });
    const ffprobe = await this.runBinary(this.ffprobePath, { args: ['-version'], timeoutMs: 5_000 });
    return {
      ffmpeg: ffmpeg.stdout.split('\n')[0] ?? 'unknown',
      ffprobe: ffprobe.stdout.split('\n')[0] ?? 'unknown',
    };
  }

  async ensureAvailable(): Promise<void> {
    const ok = await this.isAvailable();
    if (!ok) {
      throw new Error('FFmpeg/FFprobe are not available on PATH');
    }
  }

  async createTempDir(prefix = 'video-render-'): Promise<string> {
    const dir = join(tmpdir(), `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  async cleanupTemporaryFiles(paths: Array<string | null | undefined>): Promise<void> {
    for (const path of paths) {
      if (!path) continue;
      try {
        await rm(path, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  }

  async probeMedia(filePath: string, signal?: AbortSignal): Promise<ProbeMediaResult> {
    const result = await this.runBinary(this.ffprobePath, {
      args: ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', filePath],
      timeoutMs: 30_000,
      signal,
    });
    const parsed = JSON.parse(result.stdout) as {
      format?: { duration?: string; format_name?: string; size?: string };
      streams?: Array<{
        codec_type?: string;
        codec_name?: string;
        width?: number;
        height?: number;
        avg_frame_rate?: string;
        r_frame_rate?: string;
        sample_rate?: string;
        channels?: number;
      }>;
    };

    const videoStream = parsed.streams?.find((stream) => stream.codec_type === 'video');
    const audioStream = parsed.streams?.find((stream) => stream.codec_type === 'audio');

    return {
      durationSeconds: parsed.format?.duration ? Number.parseFloat(parsed.format.duration) : null,
      width: videoStream?.width ?? null,
      height: videoStream?.height ?? null,
      frameRate:
        parseFrameRate(videoStream?.avg_frame_rate) ?? parseFrameRate(videoStream?.r_frame_rate),
      videoCodec: videoStream?.codec_name ?? null,
      audioCodec: audioStream?.codec_name ?? null,
      sampleRate: audioStream?.sample_rate ? Number.parseInt(audioStream.sample_rate, 10) : null,
      channels: audioStream?.channels ?? null,
      hasVideo: Boolean(videoStream),
      hasAudio: Boolean(audioStream),
      formatName: parsed.format?.format_name ?? null,
      fileSize: parsed.format?.size ? Number.parseInt(parsed.format.size, 10) : null,
      raw: parsed as unknown as Record<string, unknown>,
    };
  }

  /** Alias used by existing video-validation helpers */
  async probe(filePath: string): Promise<FfmpegRunResult> {
    return this.runBinary(this.ffprobePath, {
      args: ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', filePath],
      timeoutMs: 30_000,
    });
  }

  private buildScalePadFilter(
    profile: VideoOutputProfile,
    fitMode: 'crop' | 'blur_pad',
  ): string {
    const { width, height } = profile;
    if (fitMode === 'blur_pad') {
      return [
        `split[fg][bg]`,
        `[bg]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},gblur=sigma=20[bgblur]`,
        `[fg]scale=${width}:${height}:force_original_aspect_ratio=decrease[fgfit]`,
        `[bgblur][fgfit]overlay=(W-w)/2:(H-h)/2`,
      ].join(';');
    }
    return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1`;
  }

  async createImageSegment(options: {
    imagePath: string;
    outputPath: string;
    durationSeconds: number;
    profile: VideoOutputProfile;
    kenBurns?: boolean;
    kenBurnsZoom?: number;
    fitMode?: 'crop' | 'blur_pad';
    signal?: AbortSignal;
  }): Promise<string> {
    const duration = Math.max(0.1, options.durationSeconds);
    const fps = options.profile.frameRate;
    const frames = Math.max(1, Math.round(duration * fps));
    const zoom = options.kenBurnsZoom ?? 1.08;
    const fitMode = options.fitMode ?? 'crop';

    let vf: string;
    if (options.kenBurns !== false) {
      const zEnd = zoom.toFixed(4);
      vf = [
        `scale=${options.profile.width * 2}:${options.profile.height * 2}:force_original_aspect_ratio=increase`,
        `crop=${options.profile.width * 2}:${options.profile.height * 2}`,
        `zoompan=z='min(zoom+0.0008\\,${zEnd})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${options.profile.width}x${options.profile.height}:fps=${fps}`,
        'setsar=1',
        `format=${options.profile.pixelFormat}`,
      ].join(',');
    } else {
      vf = `${this.buildScalePadFilter(options.profile, fitMode)},fps=${fps},format=${options.profile.pixelFormat}`;
    }

    await this.run({
      args: [
        '-y',
        '-loop',
        '1',
        '-i',
        options.imagePath,
        '-f',
        'lavfi',
        '-i',
        `anullsrc=channel_layout=stereo:sample_rate=${options.profile.audioSampleRate}`,
        '-t',
        duration.toFixed(3),
        '-vf',
        vf,
        '-c:v',
        options.profile.videoCodec,
        '-preset',
        options.profile.qualityPreset,
        '-crf',
        String(options.profile.crf),
        '-pix_fmt',
        options.profile.pixelFormat,
        '-r',
        String(fps),
        '-c:a',
        options.profile.audioCodec,
        '-ar',
        String(options.profile.audioSampleRate),
        '-ac',
        String(options.profile.audioChannels),
        '-shortest',
        '-movflags',
        '+faststart',
        options.outputPath,
      ],
      timeoutMs: Math.max(60_000, duration * 20_000),
      signal: options.signal,
    });

    return options.outputPath;
  }

  async createSceneSegment(options: {
    motionPath?: string | null;
    imagePath?: string | null;
    outputPath: string;
    durationSeconds: number;
    motionTrimSeconds?: number | null;
    extendWithImageSeconds?: number;
    profile: VideoOutputProfile;
    kenBurns?: boolean;
    kenBurnsZoom?: number;
    fitMode?: 'crop' | 'blur_pad';
    signal?: AbortSignal;
    workDir: string;
  }): Promise<string> {
    const duration = Math.max(0.1, options.durationSeconds);
    const extend = Math.max(0, options.extendWithImageSeconds ?? 0);

    if (options.motionPath) {
      const motionPart = join(options.workDir, `motion-${Date.now()}.mp4`);
      const trimTo = options.motionTrimSeconds ?? duration - extend;
      await this.normalizeVideo({
        inputPath: options.motionPath,
        outputPath: motionPart,
        profile: options.profile,
        durationSeconds: Math.max(0.1, trimTo),
        fitMode: options.fitMode,
        signal: options.signal,
      });

      if (extend > 0.05 && options.imagePath) {
        const imagePart = join(options.workDir, `image-ext-${Date.now()}.mp4`);
        await this.createImageSegment({
          imagePath: options.imagePath,
          outputPath: imagePart,
          durationSeconds: extend,
          profile: options.profile,
          kenBurns: options.kenBurns,
          kenBurnsZoom: options.kenBurnsZoom,
          fitMode: options.fitMode,
          signal: options.signal,
        });
        await this.combineSegments({
          segmentPaths: [motionPart, imagePart],
          outputPath: options.outputPath,
          profile: options.profile,
          signal: options.signal,
          workDir: options.workDir,
        });
        return options.outputPath;
      }

      await access(motionPart, fsConstants.R_OK);
      // rename via ffmpeg copy to desired output for consistent naming
      await this.run({
        args: ['-y', '-i', motionPart, '-c', 'copy', '-movflags', '+faststart', options.outputPath],
        timeoutMs: 60_000,
        signal: options.signal,
      });
      return options.outputPath;
    }

    if (!options.imagePath) {
      throw new Error('Scene segment requires a motion clip or image');
    }

    return this.createImageSegment({
      imagePath: options.imagePath,
      outputPath: options.outputPath,
      durationSeconds: duration,
      profile: options.profile,
      kenBurns: options.kenBurns,
      kenBurnsZoom: options.kenBurnsZoom,
      fitMode: options.fitMode,
      signal: options.signal,
    });
  }

  async normalizeVideo(options: {
    inputPath: string;
    outputPath: string;
    profile: VideoOutputProfile;
    durationSeconds?: number;
    fitMode?: 'crop' | 'blur_pad';
    signal?: AbortSignal;
  }): Promise<string> {
    const fitMode = options.fitMode ?? 'crop';
    const vf = `${this.buildScalePadFilter(options.profile, fitMode)},fps=${options.profile.frameRate},format=${options.profile.pixelFormat}`;
    const args = [
      '-y',
      '-i',
      options.inputPath,
      '-f',
      'lavfi',
      '-i',
      `anullsrc=channel_layout=stereo:sample_rate=${options.profile.audioSampleRate}`,
      '-vf',
      vf,
      '-c:v',
      options.profile.videoCodec,
      '-preset',
      options.profile.qualityPreset,
      '-crf',
      String(options.profile.crf),
      '-pix_fmt',
      options.profile.pixelFormat,
      '-r',
      String(options.profile.frameRate),
      '-c:a',
      options.profile.audioCodec,
      '-ar',
      String(options.profile.audioSampleRate),
      '-ac',
      String(options.profile.audioChannels),
      '-shortest',
      '-movflags',
      '+faststart',
    ];
    if (options.durationSeconds != null) {
      args.splice(args.indexOf('-vf'), 0, '-t', options.durationSeconds.toFixed(3));
    }
    args.push(options.outputPath);

    await this.run({
      args,
      timeoutMs: Math.max(60_000, (options.durationSeconds ?? 30) * 20_000),
      signal: options.signal,
    });
    return options.outputPath;
  }

  async synchronizeNarration(options: {
    sceneAudioPaths: Array<{ path: string; startSeconds: number; durationSeconds: number }>;
    outputPath: string;
    totalDurationSeconds: number;
    profile: VideoOutputProfile;
    narrationVolume?: number;
    fadeInSeconds?: number;
    fadeOutSeconds?: number;
    signal?: AbortSignal;
  }): Promise<string> {
    if (options.sceneAudioPaths.length === 0) {
      throw new Error('No narration audio clips provided');
    }

    const inputs: string[] = [];
    const filterParts: string[] = [];
    const totalDur = Math.max(0.1, options.totalDurationSeconds);
    options.sceneAudioPaths.forEach((clip, index) => {
      inputs.push('-i', clip.path);
      const delayMs = Math.max(0, Math.round(clip.startSeconds * 1000));
      const volume = options.narrationVolume ?? 1;
      // adelay + apad so every scene spans the full timeline before amix.
      filterParts.push(
        `[${index}:a]aformat=sample_rates=${options.profile.audioSampleRate}:channel_layouts=stereo,volume=${volume},atrim=0:${clip.durationSeconds.toFixed(3)},asetpts=PTS-STARTPTS,adelay=${delayMs}|${delayMs},apad=whole_dur=${totalDur.toFixed(3)}[a${index}]`,
      );
    });

    const mixInputs = options.sceneAudioPaths.map((_, index) => `[a${index}]`).join('');
    const fadeIn = options.fadeInSeconds ?? 0;
    const fadeOut = options.fadeOutSeconds ?? 0;
    // filterParts must be included — without them FFmpeg remaps input 0 onto every [aN] pad
    // and the mix collapses to the first scene's duration only.
    let mixFilter = `${filterParts.join(';')};${mixInputs}amix=inputs=${options.sceneAudioPaths.length}:duration=first:dropout_transition=0:normalize=0[amixed]`;
    if (fadeIn > 0 || fadeOut > 0) {
      const fadeFilters: string[] = [];
      if (fadeIn > 0) fadeFilters.push(`afade=t=in:st=0:d=${fadeIn.toFixed(3)}`);
      if (fadeOut > 0) {
        const start = Math.max(0, totalDur - fadeOut);
        fadeFilters.push(`afade=t=out:st=${start.toFixed(3)}:d=${fadeOut.toFixed(3)}`);
      }
      mixFilter += `;[amixed]${fadeFilters.join(',')}[aout]`;
    } else {
      mixFilter += `;[amixed]anull[aout]`;
    }

    await this.run({
      args: [
        '-y',
        ...inputs,
        '-filter_complex',
        mixFilter,
        '-map',
        '[aout]',
        '-t',
        totalDur.toFixed(3),
        '-c:a',
        options.profile.audioCodec,
        '-ar',
        String(options.profile.audioSampleRate),
        '-ac',
        String(options.profile.audioChannels),
        options.outputPath,
      ],
      timeoutMs: Math.max(60_000, totalDur * 10_000),
      signal: options.signal,
    });

    return options.outputPath;
  }

  async mixAudio(options: {
    narrationPath: string;
    musicPath?: string | null;
    sfxPaths?: Array<{ path: string; startSeconds: number; volume?: number }>;
    outputPath: string;
    totalDurationSeconds: number;
    profile: VideoOutputProfile;
    musicVolume?: number;
    duckingEnabled?: boolean;
    duckingThresholdDb?: number;
    duckingRatio?: number;
    duckingAttackMs?: number;
    duckingReleaseMs?: number;
    musicFadeInSeconds?: number;
    musicFadeOutSeconds?: number;
    signal?: AbortSignal;
  }): Promise<string> {
    if (!options.musicPath && (!options.sfxPaths || options.sfxPaths.length === 0)) {
      await this.run({
        args: ['-y', '-i', options.narrationPath, '-c', 'copy', options.outputPath],
        timeoutMs: 30_000,
        signal: options.signal,
      });
      return options.outputPath;
    }

    const args: string[] = ['-y', '-i', options.narrationPath];
    let inputIndex = 1;
    const filters: string[] = [];
    filters.push(
      `[0:a]aformat=sample_rates=${options.profile.audioSampleRate}:channel_layouts=stereo[narr]`,
    );

    let musicLabel: string | null = null;
    if (options.musicPath) {
      args.push('-stream_loop', '-1', '-i', options.musicPath);
      const musicIdx = inputIndex;
      inputIndex += 1;
      const vol = options.musicVolume ?? 0.22;
      const fadeIn = options.musicFadeInSeconds ?? 0.4;
      const fadeOut = options.musicFadeOutSeconds ?? 0.6;
      const fadeOutStart = Math.max(0, options.totalDurationSeconds - fadeOut);
      let musicChain = `[${musicIdx}:a]aformat=sample_rates=${options.profile.audioSampleRate}:channel_layouts=stereo,volume=${vol},atrim=0:${options.totalDurationSeconds.toFixed(3)},asetpts=PTS-STARTPTS`;
      if (fadeIn > 0) musicChain += `,afade=t=in:st=0:d=${fadeIn.toFixed(3)}`;
      if (fadeOut > 0) musicChain += `,afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeOut.toFixed(3)}`;
      musicChain += '[musicraw]';
      filters.push(musicChain);

      if (options.duckingEnabled !== false) {
        filters.push(
          `[musicraw][narr]sidechaincompress=threshold=${Math.pow(10, (options.duckingThresholdDb ?? -18) / 20)}:ratio=${options.duckingRatio ?? 8}:attack=${options.duckingAttackMs ?? 80}:release=${options.duckingReleaseMs ?? 400}:makeup=1[music]`,
        );
        musicLabel = 'music';
      } else {
        musicLabel = 'musicraw';
      }
    }

    const sfxLabels: string[] = [];
    for (const sfx of options.sfxPaths ?? []) {
      args.push('-i', sfx.path);
      const idx = inputIndex;
      inputIndex += 1;
      const delayMs = Math.max(0, Math.round(sfx.startSeconds * 1000));
      const vol = sfx.volume ?? 0.35;
      const label = `sfx${sfxLabels.length}`;
      filters.push(
        `[${idx}:a]aformat=sample_rates=${options.profile.audioSampleRate}:channel_layouts=stereo,volume=${vol},adelay=${delayMs}|${delayMs}[${label}]`,
      );
      sfxLabels.push(label);
    }

    const mixParts = ['[narr]', ...(musicLabel ? [`[${musicLabel}]`] : []), ...sfxLabels.map((l) => `[${l}]`)];
    filters.push(
      `${mixParts.join('')}amix=inputs=${mixParts.length}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[aout]`,
    );

    await this.run({
      args: [
        ...args,
        '-filter_complex',
        filters.join(';'),
        '-map',
        '[aout]',
        '-t',
        options.totalDurationSeconds.toFixed(3),
        '-c:a',
        options.profile.audioCodec,
        '-ar',
        String(options.profile.audioSampleRate),
        '-ac',
        String(options.profile.audioChannels),
        options.outputPath,
      ],
      timeoutMs: Math.max(60_000, options.totalDurationSeconds * 15_000),
      signal: options.signal,
    });

    return options.outputPath;
  }

  async generateSubtitles(options: {
    srtContent: string;
    assContent: string;
    srtPath: string;
    assPath: string;
  }): Promise<{ srtPath: string; assPath: string }> {
    await writeFile(options.srtPath, options.srtContent, 'utf8');
    await writeFile(options.assPath, options.assContent, 'utf8');
    return { srtPath: options.srtPath, assPath: options.assPath };
  }

  async combineSegments(options: {
    segmentPaths: string[];
    outputPath: string;
    profile: VideoOutputProfile;
    signal?: AbortSignal;
    workDir: string;
  }): Promise<string> {
    if (options.segmentPaths.length === 0) {
      throw new Error('No segments to combine');
    }
    if (options.segmentPaths.length === 1) {
      await this.run({
        args: [
          '-y',
          '-i',
          options.segmentPaths[0],
          '-c',
          'copy',
          '-movflags',
          '+faststart',
          options.outputPath,
        ],
        timeoutMs: 60_000,
        signal: options.signal,
      });
      return options.outputPath;
    }

    const listPath = join(options.workDir, `concat-${Date.now()}.txt`);
    const listBody = options.segmentPaths
      .map((path) => `file '${path.replace(/'/g, `'\\''`)}'`)
      .join('\n');
    await writeFile(listPath, listBody, 'utf8');

    await this.run({
      args: [
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        listPath,
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        options.outputPath,
      ],
      timeoutMs: Math.max(120_000, options.segmentPaths.length * 60_000),
      signal: options.signal,
    });
    return options.outputPath;
  }

  async hasFilter(filterName: string): Promise<boolean> {
    try {
      const result = await this.run({ args: ['-hide_banner', '-filters'], timeoutMs: 10_000 });
      const needle = ` ${filterName} `;
      return result.stdout.includes(needle) || result.stderr.includes(needle);
    } catch {
      return false;
    }
  }

  async muxFinalVideo(options: {
    videoPath: string;
    audioPath: string;
    outputPath: string;
    profile: VideoOutputProfile;
    assSubtitlePath?: string | null;
    srtSubtitlePath?: string | null;
    burnSubtitles?: boolean;
    subtitleCues?: SubtitleCue[];
    subtitleStyle?: SubtitleStyle;
    workDir?: string;
    signal?: AbortSignal;
  }): Promise<string> {
    const videoProbe = await this.probeMedia(options.videoPath, options.signal);
    const duration = videoProbe.durationSeconds;
    const wantBurn = Boolean(options.burnSubtitles);

    const canBurnAss =
      wantBurn && Boolean(options.assSubtitlePath) && (await this.hasFilter('ass'));
    const canBurnSubtitlesFilter =
      wantBurn &&
      Boolean(options.assSubtitlePath || options.srtSubtitlePath) &&
      (await this.hasFilter('subtitles'));

    if (canBurnAss && options.assSubtitlePath) {
      await this.muxWithVideoFilter({
        videoPath: options.videoPath,
        audioPath: options.audioPath,
        outputPath: options.outputPath,
        profile: options.profile,
        videoFilter: `ass='${escapeFilterPath(options.assSubtitlePath)}'`,
        durationSeconds: duration,
        signal: options.signal,
      });
      return options.outputPath;
    }

    if (canBurnSubtitlesFilter) {
      const subPath = options.assSubtitlePath || options.srtSubtitlePath;
      if (subPath) {
        await this.muxWithVideoFilter({
          videoPath: options.videoPath,
          audioPath: options.audioPath,
          outputPath: options.outputPath,
          profile: options.profile,
          videoFilter: `subtitles='${escapeFilterPath(subPath)}'`,
          durationSeconds: duration,
          signal: options.signal,
        });
        return options.outputPath;
      }
    }

    // Fallback for FFmpeg builds without libass: burn PNG caption overlays (visible on social).
    if (
      wantBurn &&
      options.subtitleCues?.length &&
      options.subtitleStyle &&
      options.workDir &&
      (await this.hasFilter('overlay'))
    ) {
      const overlays = await prepareSubtitleOverlays({
        cues: options.subtitleCues,
        width: options.profile.width,
        height: options.profile.height,
        style: options.subtitleStyle,
        workDir: options.workDir,
      });
      if (overlays.length > 0) {
        const { inputArgs, filter, videoLabel } = await writeSubtitleOverlayInputs(
          options.workDir,
          overlays,
        );
        const args = [
          '-y',
          '-i',
          options.videoPath,
          ...inputArgs,
          '-i',
          options.audioPath,
          '-filter_complex',
          filter,
          '-map',
          `[${videoLabel}]`,
          '-map',
          `${1 + overlays.length}:a:0`,
          '-c:v',
          options.profile.videoCodec,
          '-preset',
          options.profile.qualityPreset,
          '-crf',
          String(options.profile.crf),
          '-pix_fmt',
          options.profile.pixelFormat,
          '-c:a',
          options.profile.audioCodec,
          '-ar',
          String(options.profile.audioSampleRate),
          '-ac',
          String(options.profile.audioChannels),
          '-movflags',
          '+faststart',
        ];
        if (duration && duration > 0) {
          args.push('-t', duration.toFixed(3));
        }
        args.push(options.outputPath);
        await this.run({
          args,
          timeoutMs: FFMPEG_DEFAULT_TIMEOUT_MS,
          signal: options.signal,
        });
        return options.outputPath;
      }
    }

    // Soft-mux only when burn-in was not requested. Soft tracks are invisible on most social apps.
    if (!wantBurn && options.srtSubtitlePath) {
      const args = [
        '-y',
        '-i',
        options.videoPath,
        '-i',
        options.audioPath,
        '-i',
        options.srtSubtitlePath,
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-map',
        '2:0',
        '-c:v',
        'copy',
        '-c:a',
        options.profile.audioCodec,
        '-ar',
        String(options.profile.audioSampleRate),
        '-ac',
        String(options.profile.audioChannels),
        '-c:s',
        'mov_text',
      ];
      if (duration && duration > 0) {
        args.push('-t', duration.toFixed(3));
      }
      args.push('-movflags', '+faststart', options.outputPath);
      await this.run({
        args,
        timeoutMs: FFMPEG_DEFAULT_TIMEOUT_MS,
        signal: options.signal,
      });
      return options.outputPath;
    }

    if (wantBurn) {
      throw new Error(
        'Burned-in subtitles were requested but FFmpeg has no libass/subtitles filter and overlay burn-in failed. Install ffmpeg with libass or ensure subtitle cues are present.',
      );
    }

    {
      const args = [
        '-y',
        '-i',
        options.videoPath,
        '-i',
        options.audioPath,
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-c:v',
        'copy',
        '-c:a',
        options.profile.audioCodec,
        '-ar',
        String(options.profile.audioSampleRate),
        '-ac',
        String(options.profile.audioChannels),
        '-movflags',
        '+faststart',
      ];
      if (duration && duration > 0) {
        args.push('-t', duration.toFixed(3));
      }
      args.push(options.outputPath);
      await this.run({
        args,
        timeoutMs: FFMPEG_DEFAULT_TIMEOUT_MS,
        signal: options.signal,
      });
    }
    return options.outputPath;
  }

  private async muxWithVideoFilter(options: {
    videoPath: string;
    audioPath: string;
    outputPath: string;
    profile: VideoOutputProfile;
    videoFilter: string;
    durationSeconds: number | null;
    signal?: AbortSignal;
  }): Promise<void> {
    const args = [
      '-y',
      '-i',
      options.videoPath,
      '-i',
      options.audioPath,
      '-vf',
      options.videoFilter,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c:v',
      options.profile.videoCodec,
      '-preset',
      options.profile.qualityPreset,
      '-crf',
      String(options.profile.crf),
      '-pix_fmt',
      options.profile.pixelFormat,
      '-c:a',
      options.profile.audioCodec,
      '-ar',
      String(options.profile.audioSampleRate),
      '-ac',
      String(options.profile.audioChannels),
      '-movflags',
      '+faststart',
    ];
    if (options.durationSeconds && options.durationSeconds > 0) {
      args.push('-t', options.durationSeconds.toFixed(3));
    }
    args.push(options.outputPath);
    await this.run({
      args,
      timeoutMs: FFMPEG_DEFAULT_TIMEOUT_MS,
      signal: options.signal,
    });
  }

  async validateOutput(filePath: string, signal?: AbortSignal): Promise<ProbeMediaResult> {
    const probe = await this.probeMedia(filePath, signal);
    if (!probe.hasVideo) {
      throw new Error('Rendered output has no video stream');
    }
    if (!probe.hasAudio) {
      throw new Error('Rendered output has no audio stream');
    }
    if (!probe.width || !probe.height) {
      throw new Error('Rendered output is missing dimensions');
    }
    if (!probe.durationSeconds || probe.durationSeconds < 0.1) {
      throw new Error('Rendered output duration is invalid');
    }
    return probe;
  }

  async run(options: FfmpegRunOptions): Promise<FfmpegRunResult> {
    return this.runBinary(this.ffmpegPath, options);
  }

  killActiveProcesses(): void {
    for (const child of this.activeProcesses) {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
      globalActiveProcesses.delete(child);
    }
    this.activeProcesses.clear();
  }

  private threadArgs(binary: string, args: string[]): string[] {
    if (binary !== this.ffmpegPath) return args;
    const threads = Number.parseInt(process.env.FFMPEG_THREADS ?? '2', 10);
    if (!Number.isFinite(threads) || threads <= 0) return args;
    // Avoid duplicating if caller already set -threads
    if (args.includes('-threads')) return args;
    return ['-threads', String(threads), '-filter_threads', String(Math.max(1, Math.min(threads, 4))), ...args];
  }

  private runBinary(binary: string, options: FfmpegRunOptions): Promise<FfmpegRunResult> {
    const timeoutMs = options.timeoutMs ?? FFMPEG_DEFAULT_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new Error(`${binary} aborted before start`));
        return;
      }

      const child = spawn(binary, this.threadArgs(binary, options.args), {
        cwd: options.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      }) as unknown as ChildProcessWithoutNullStreams;

      this.activeProcesses.add(child);
      globalActiveProcesses.add(child);

      let stdout = '';
      let stderr = '';
      let settled = false;

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        this.activeProcesses.delete(child);
        globalActiveProcesses.delete(child);
        fn();
      };

      const timer = setTimeout(() => {
        settle(() => {
          child.kill('SIGKILL');
          reject(new Error(`${binary} timed out after ${timeoutMs}ms`));
        });
      }, timeoutMs);

      const onAbort = () => {
        settle(() => {
          child.kill('SIGKILL');
          reject(new Error(`${binary} cancelled`));
        });
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        if (options.onProgress) {
          const timeMatch = text.match(/out_time_ms=(\d+)/);
          const frameMatch = text.match(/frame=\s*(\d+)/);
          options.onProgress({
            outTimeMs: timeMatch ? Number.parseInt(timeMatch[1], 10) : undefined,
            frame: frameMatch ? Number.parseInt(frameMatch[1], 10) : undefined,
          });
        }
      });

      child.on('error', (error) => {
        settle(() => reject(error));
      });

      child.on('close', (code) => {
        settle(() => {
          const exitCode = code ?? 1;
          if (exitCode !== 0) {
            reject(
              new Error(
                `${binary} exited with code ${exitCode}: ${stderr.slice(-2000) || 'no stderr'}`,
              ),
            );
            return;
          }
          resolve({ stdout, stderr, exitCode });
        });
      });
    });
  }
}
