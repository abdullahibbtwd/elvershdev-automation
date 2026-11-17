import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const JOB_ID = process.env.PUBLISH_JOB_ID || '6573bba4-7644-47b4-815d-fd0bb1782d5c';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = app.get(PrismaService);
  const job = await prisma.publishRecord.findUnique({
    where: { id: JOB_ID },
    select: {
      id: true,
      status: true,
      postUrl: true,
      externalPostId: true,
      providerPostId: true,
      errorCode: true,
      errorMessage: true,
      uploadProgress: true,
      publishedAt: true,
      submittedAt: true,
      generationJobId: true,
    },
  });
  let gen = null;
  if (job?.generationJobId) {
    gen = await prisma.generationJob.findUnique({
      where: { id: job.generationJobId },
      select: { status: true, progress: true, errorMessage: true, queueName: true },
    });
  }
  console.log(JSON.stringify({ job, gen }, null, 2));
  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
