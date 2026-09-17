/**
 * Backs the round-robin assignment cursor (assignment_cursor table: a single
 * fixed row holding the last-used index). `incrementAndGet` must be an
 * atomic `UPDATE ... RETURNING` so concurrent ticket creations never race
 * each other into assigning two tickets to the same "next" agent.
 */
export interface IAssignmentCursorRepository {
  incrementAndGet(): Promise<number>;
  reset(): Promise<void>;
}
