import { z } from 'zod';

export const examAnswersSchema = z.record(z.string().regex(/^(?:[1-9]|1\d|2[0-3])$/), z.string().max(8000));
export const examMarksSchema = z.record(z.string().regex(/^(?:[1-9]|1\d|2[0-3])$/), z.enum(['wrong', 'correct']));
export const annotationStrokeSchema = z.object({
  tool: z.enum(['pen', 'highlighter']),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  width: z.number().min(1).max(40).optional(),
  points: z.array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)])).min(1).max(1500),
});
export type AnnotationStroke = z.infer<typeof annotationStrokeSchema>;
export const examRecordSchema = z.object({ answers: examAnswersSchema, marks: examMarksSchema, markedAt: z.record(z.string().regex(/^(?:[1-9]|1\d|2[0-3])$/), z.string().datetime()).optional(), annotations: z.record(z.string().regex(/^[1-9]\d{0,2}$/), z.array(annotationStrokeSchema).max(1000)).default({}) });
export type ExamRecord = z.infer<typeof examRecordSchema>;
export const emptyExamRecord = (): ExamRecord => ({ answers: {}, marks: {}, annotations: {} });
export const wrongQuestionNumbers = (record: ExamRecord) => Object.entries(record.marks).filter(([, mark]) => mark === 'wrong').map(([number]) => Number(number)).sort((a, b) => a - b);
export function eraseAnnotationStroke(strokes: AnnotationStroke[], x: number, y: number, width: number, height: number, radius = 16): AnnotationStroke[] {
  const index = strokes.findLastIndex(stroke => stroke.points.some(([pointX, pointY]) => Math.hypot((pointX - x) * width, (pointY - y) * height) < radius + (stroke.width ?? (stroke.tool === 'highlighter' ? 18 : 2.5)) / 2));
  return index < 0 ? strokes : strokes.filter((_, position) => position !== index);
}
export function eraseAnnotationRange(strokes: AnnotationStroke[], x: number, y: number, width: number, height: number, radius = 16): AnnotationStroke[] {
  let changed = false;
  const remaining = strokes.flatMap(stroke => {
    const pieces: AnnotationStroke[] = [];
    let points: AnnotationStroke['points'] = [];
    const reach = radius + (stroke.width ?? (stroke.tool === 'highlighter' ? 18 : 2.5)) / 2;
    for (const point of stroke.points) {
      if (Math.hypot((point[0] - x) * width, (point[1] - y) * height) <= reach) {
        changed = true;
        if (points.length) pieces.push({ ...stroke, points });
        points = [];
      } else points.push(point);
    }
    if (points.length) pieces.push({ ...stroke, points });
    return pieces;
  });
  return changed ? remaining : strokes;
}
