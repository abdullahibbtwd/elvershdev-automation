import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = app.get(PrismaService);
  const user = await prisma.user.findUnique({ where: { email: 'abdullahibbtwd@gmail.com' } });
  if (!user) throw new Error('user missing');

  const series = await prisma.storySeries.findMany({
    where: {
      userId: user.id,
      OR: [
        { title: 'The Unfair Mirror' },
        { slug: { startsWith: 'dialogue-pilot-' } },
        { metadata: { path: ['pilot'], equals: true } },
        { metadata: { path: ['dialogueDriven'], equals: true } },
      ],
    },
    select: { id: true, title: true, slug: true, createdAt: true, metadata: true },
    orderBy: { createdAt: 'asc' },
  });

  const seriesIds = series.map((s) => s.id);
  const refs = await prisma.characterReferenceAsset.findMany({
    where: { seriesCharacter: { seriesId: { in: seriesIds } } },
    include: {
      seriesCharacter: { select: { name: true, seriesId: true } },
      mediaAsset: { select: { id: true, metadata: true, fileSize: true, createdAt: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const lipJobs = await prisma.lipSyncJob.findMany({
    where: { userId: user.id, episode: { seriesId: { in: seriesIds } } },
    orderBy: { createdAt: 'asc' },
  });

  const lines = await prisma.episodeDialogueLine.findMany({
    where: { userId: user.id, episode: { seriesId: { in: seriesIds } } },
    orderBy: { createdAt: 'asc' },
  });

  const since = new Date('2026-11-17T08:50:00.000Z');
  const until = new Date('2026-11-17T09:20:00.000Z');
  const usages = await prisma.providerUsage.findMany({
    where: { userId: user.id, createdAt: { gte: since, lte: until } },
    orderBy: { createdAt: 'asc' },
  });

  const dayStart = new Date('2026-11-17T00:00:00.000Z');
  const dayEnd = new Date('2026-11-17T23:59:59.999Z');
  const dayUsages = await prisma.providerUsage.findMany({
    where: { userId: user.id, createdAt: { gte: dayStart, lte: dayEnd } },
    orderBy: { createdAt: 'asc' },
  });

  const media = await prisma.mediaAsset.findMany({
    where: {
      userId: user.id,
      createdAt: { gte: since, lte: until },
    },
    select: { id: true, type: true, storageKey: true, metadata: true, fileSize: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const num = (v: unknown) => (v == null ? 0 : Number(v));

  const lipCosts = lipJobs.map((j) => ({
    id: j.id,
    episodeId: j.episodeId,
    status: j.status,
    duration: j.durationSeconds,
    estimated: num(j.estimatedCostUsd),
    actual: num(j.actualCostUsd),
    mocked: j.mocked,
    createdAt: j.createdAt,
  }));

  const lineCosts = lines.map((l) => ({
    id: l.id,
    episodeId: l.episodeId,
    speaker: l.speakerName,
    status: l.status,
    duration: l.durationSeconds,
    estimated: num(l.estimatedCostUsd),
    actual: num(l.actualCostUsd),
    provider: l.provider,
    model: l.providerModel,
    createdAt: l.createdAt,
  }));

  const report = {
    series,
    portraitCount: refs.length,
    portraitsBySeries: series.map((s) => ({
      seriesId: s.id,
      slug: s.slug,
      createdAt: s.createdAt,
      refs: refs
        .filter((r) => r.seriesCharacter.seriesId === s.id)
        .map((r) => ({
          character: r.seriesCharacter.name,
          provider: r.provider,
          model: r.providerModel,
          createdAt: r.createdAt,
          mediaMeta: r.mediaAsset?.metadata,
        })),
    })),
    lipJobs: lipCosts,
    lipEstimatedSum: sum(lipCosts.map((j) => j.actual || j.estimated)),
    dialogueLines: lineCosts,
    ttsEstimatedSum: sum(lineCosts.map((l) => l.actual || l.estimated)),
    providerUsagesPilotWindow: usages.map((u) => ({
      provider: u.provider,
      model: u.model,
      requestType: u.requestType,
      estimatedCost: num(u.estimatedCost),
      createdAt: u.createdAt,
      metadata: u.metadata,
    })),
    providerUsagePilotWindowSum: sum(usages.map((u) => num(u.estimatedCost))),
    providerUsagesDay: dayUsages.map((u) => ({
      provider: u.provider,
      model: u.model,
      requestType: u.requestType,
      estimatedCost: num(u.estimatedCost),
      createdAt: u.createdAt,
    })),
    providerUsageDaySum: sum(dayUsages.map((u) => num(u.estimatedCost))),
    providerUsageDayByProvider: Object.entries(
      dayUsages.reduce<Record<string, { count: number; cost: number }>>((acc, u) => {
        const key = `${u.provider}:${u.requestType}`;
        acc[key] ??= { count: 0, cost: 0 };
        acc[key].count += 1;
        acc[key].cost += num(u.estimatedCost);
        return acc;
      }, {}),
    ),
    mediaPilotWindow: media.map((m) => ({
      id: m.id,
      type: m.type,
      key: m.storageKey,
      size: Number(m.fileSize),
      createdAt: m.createdAt,
      meta: m.metadata,
    })),
  };

  console.log(JSON.stringify(report, null, 2));
  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
