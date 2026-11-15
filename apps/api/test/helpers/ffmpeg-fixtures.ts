import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

function run(binary: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${binary} failed (${code}): ${stderr.slice(-1000)}`));
    });
  });
}

export async function createRenderFixtures(sceneCount = 2): Promise<{
  dir: string;
  images: string[];
  videos: string[];
  wavs: string[];
}> {
  const dir = join(tmpdir(), `phase8-fixtures-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  const images: string[] = [];
  const videos: string[] = [];
  const wavs: string[] = [];

  for (let i = 0; i < sceneCount; i += 1) {
    const imagePath = join(dir, `scene-${i + 1}.png`);
    const videoPath = join(dir, `scene-${i + 1}.mp4`);
    const wavPath = join(dir, `scene-${i + 1}.wav`);

    // Distinct colored stills
    const color = i % 2 === 0 ? '0x224466' : '0x663322';
    await run('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=${color}:s=720x1280:d=1`,
      '-frames:v',
      '1',
      imagePath,
    ]);

    await run('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=${color}:s=720x1280:d=2`,
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=44100:cl=mono',
      '-t',
      '2',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      videoPath,
    ]);

    // Short sine-wave narration stand-in (~1.5s)
    await run('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=${440 + i * 40}:duration=1.5`,
      '-ar',
      '24000',
      '-ac',
      '1',
      wavPath,
    ]);

    images.push(imagePath);
    videos.push(videoPath);
    wavs.push(wavPath);
  }

  return { dir, images, videos, wavs };
}

export async function cleanupFixtures(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export async function uploadFixtureToMinio(key: string, filePath: string, contentType: string) {
  const endpoint = process.env.MINIO_ENDPOINT ?? 'http://localhost:9000';
  const bucket = process.env.MINIO_BUCKET ?? 'ai-video';
  const client = new S3Client({
    endpoint,
    region: process.env.MINIO_REGION ?? 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.MINIO_ACCESS_KEY ?? 'minioadmin',
      secretAccessKey: process.env.MINIO_SECRET_KEY ?? 'minioadmin',
    },
  });

  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }

  const body = await readFile(filePath);
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function writeTextFixture(dir: string, name: string, contents: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, contents, 'utf8');
  return path;
}
