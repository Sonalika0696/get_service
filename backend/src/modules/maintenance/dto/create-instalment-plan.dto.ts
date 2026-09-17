import { IsInt, Min } from 'class-validator';

/** Body of POST /maintenance/charges/:id/instalment-plan. */
export class CreateInstalmentPlanDto {
  /** Number of instalments to split the charge's outstanding balance across; must be at least 2 (1 instalment is just "pay in full"). */
  @IsInt()
  @Min(2)
  instalments!: number;
}
