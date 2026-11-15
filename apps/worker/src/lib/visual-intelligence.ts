import {
  resolveBuiltinStyle,
  visualStyleConfigurationSchema,
  type VisualStyleConfiguration,
} from '@ai-video/shared';
import { analyzeVisuals, type AnalyzeVisualsInput, type GeminiJsonResult } from './gemini';
import type { VisualAnalysisBatch } from '@ai-video/shared';
import type { getPrisma } from './prisma';

export interface ResolvedVisualStyle {
  id: string | null;
  name: string;
  configuration: VisualStyleConfiguration;
}

function parseStyleConfiguration(raw: unknown, fallbackName?: string): VisualStyleConfiguration {
  const parsed = visualStyleConfigurationSchema.safeParse(raw);
  if (parsed.success) {
    return parsed.data;
  }
  return resolveBuiltinStyle(fallbackName).configuration;
}

export async function resolveVisualStyle(
  prisma: ReturnType<typeof getPrisma>,
  options: {
    userId?: string;
    requestedStyleId?: string | null;
    storyStyleId?: string | null;
  },
): Promise<ResolvedVisualStyle> {
  const candidateId = options.requestedStyleId ?? options.storyStyleId;
  if (candidateId) {
    const style = await prisma.visualStyle.findFirst({
      where: {
        id: candidateId,
        OR: [
          ...(options.userId ? [{ userId: options.userId }] : []),
          { isSystem: true },
          { userId: null },
        ],
      },
    });
    if (style) {
      return {
        id: style.id,
        name: style.name,
        configuration: parseStyleConfiguration(style.configuration, style.name),
      };
    }
  }

  const defaultStyle = await prisma.visualStyle.findFirst({
    where: {
      isDefault: true,
      OR: [
        ...(options.userId ? [{ userId: options.userId }] : []),
        { isSystem: true },
        { userId: null },
      ],
    },
    orderBy: [{ isSystem: 'asc' }, { updatedAt: 'desc' }],
  });

  if (defaultStyle) {
    return {
      id: defaultStyle.id,
      name: defaultStyle.name,
      configuration: parseStyleConfiguration(defaultStyle.configuration, defaultStyle.name),
    };
  }

  const systemStyle = await prisma.visualStyle.findFirst({
    where: { isSystem: true },
    orderBy: { createdAt: 'asc' },
  });

  if (systemStyle) {
    return {
      id: systemStyle.id,
      name: systemStyle.name,
      configuration: parseStyleConfiguration(systemStyle.configuration, systemStyle.name),
    };
  }

  const builtin = resolveBuiltinStyle();
  return {
    id: null,
    name: builtin.name,
    configuration: builtin.configuration,
  };
}

export async function analyzeStoryVisuals(
  input: AnalyzeVisualsInput,
  options?: { forceMock?: boolean },
): Promise<GeminiJsonResult<VisualAnalysisBatch>> {
  return analyzeVisuals(input, options);
}
