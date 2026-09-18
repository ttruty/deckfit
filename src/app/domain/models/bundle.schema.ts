import { z } from 'zod';
import { GameDefinitionSchema } from './game.schema';
import { DeckSchema, ExerciseSchema, RoutineSchema } from './schemas';

/**
 * Export/import bundle (§10): user-made decks, games, routines, and the user
 * exercises they use. Built-ins are never bundled — they ship with the app and
 * are referenced by id. Also the payload of room invites.
 */
export const BundleSchema = z
  .object({
    format: z.literal('deckfit-bundle'),
    version: z.literal(1),
    exportedAt: z.number().int().nonnegative(),
    exercises: z.array(ExerciseSchema),
    decks: z.array(DeckSchema),
    games: z.array(GameDefinitionSchema),
    routines: z.array(RoutineSchema),
  })
  .superRefine((b, ctx) => {
    for (const key of ['exercises', 'decks', 'games'] as const) {
      const seen = new Set<string>();
      b[key].forEach((item, i) => {
        if (item.builtIn) ctx.addIssue({ code: 'custom', path: [key, i, 'builtIn'], message: 'bundles cannot contain built-in items' });
        if (seen.has(item.id)) ctx.addIssue({ code: 'custom', path: [key, i, 'id'], message: `duplicate id ${item.id}` });
        seen.add(item.id);
      });
    }
    const routineIds = new Set<string>();
    b.routines.forEach((r, i) => {
      if (routineIds.has(r.id)) ctx.addIssue({ code: 'custom', path: ['routines', i, 'id'], message: `duplicate id ${r.id}` });
      routineIds.add(r.id);
    });
  });
export type Bundle = z.infer<typeof BundleSchema>;
