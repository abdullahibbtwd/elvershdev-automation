import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import pg from 'pg';

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, role: true },
      take: 5,
    });
    const lanes = await prisma.seriesLane.findMany({
      select: {
        id: true,
        name: true,
        enabled: true,
        activeSeriesId: true,
        laneType: true,
        creativeSettings: true,
      },
      take: 10,
    });
    const series = await prisma.storySeries.findMany({
      select: { id: true, title: true, laneId: true, status: true, userId: true },
      take: 10,
    });
    const channels = await prisma.socialChannel.findMany({
      select: {
        id: true,
        platform: true,
        connectionStatus: true,
        accountName: true,
        userId: true,
        isActive: true,
      },
      take: 10,
    });
    const eps = await prisma.seriesEpisode.findMany({
      select: {
        id: true,
        seriesId: true,
        episodeNumber: true,
        title: true,
        status: true,
        approvalStatus: true,
        productionState: true,
        metadata: true,
      },
      take: 20,
      orderBy: { updatedAt: 'desc' },
    });
    console.log(JSON.stringify({ users, lanes, series, channels, eps }, null, 2));
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
