import { z } from 'zod';
const boxSchema=z.object({x:z.number(),y:z.number(),width:z.number().nonnegative(),height:z.number().nonnegative()});
const blockSchema=z.object({
  type:z.enum(['paragraph','table','image','math','graphic']),sourceStart:z.number().int().positive(),sourceEnd:z.number().int().positive(),
  text:z.string().optional(),rows:z.array(z.array(z.string())).optional(),part:z.string().optional(),relationshipId:z.string().optional(),assetPath:z.string().optional(),marker:z.string().optional(),bbox:boxSchema.optional(),
});
export const extractionSchema=z.object({
  state:z.enum(['complete','partial']),pageCount:z.number().int().positive(),durationMs:z.number().nonnegative(),updatedAt:z.string(),sourceCount:z.number().int().nonnegative().optional(),
  continuation:z.object({startSource:z.number().int().positive(),nextSource:z.number().int().positive().optional(),hasMore:z.boolean(),reason:z.enum(['text-limit','result-limit','time-limit','page-limit']).optional(),blockedSource:z.number().int().positive().optional()}).optional(),
  pages:z.array(z.object({page:z.number().int().positive(),text:z.string().max(60000),method:z.enum(['pdf-text','local-ocr','docx-text','pptx-text','text']),state:z.enum(['extracted','needs-ocr','empty']),confidence:z.number().min(0).max(100).optional(),warnings:z.array(z.string()),
    source:z.object({kind:z.enum(['paragraph','line','page','slide','image']),index:z.number().int().positive(),part:z.string().optional()}).optional(),blocks:z.array(blockSchema).optional(),
    numbering:z.object({numId:z.string(),level:z.number().int().nonnegative(),label:z.string(),unsupported:z.boolean().optional()}).optional(),
    layout:z.object({width:z.number().nonnegative(),height:z.number().nonnegative(),coordinateSystem:z.enum(['pdf-bottom-left','image-top-left']),lines:z.array(z.object({text:z.string(),bbox:boxSchema,confidence:z.number().optional()})),rotation:z.number().optional()}).optional(),
    ocr:z.object({rotation:z.number(),preprocessing:z.array(z.string()),orientation:z.enum(['projection','confidence','none'])}).optional(),
  })).min(1),
});
export type Extraction=z.infer<typeof extractionSchema>;
