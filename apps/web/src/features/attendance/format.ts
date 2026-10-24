/** Minutes as hours and minutes parts for the `duration` translation. */
export const splitMinutes = (minutes: number): { hours: number; minutes: number } => ({
  hours: Math.floor(minutes / 60),
  minutes: minutes % 60,
});
