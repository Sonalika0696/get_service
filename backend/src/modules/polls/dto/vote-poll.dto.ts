import { IsEnum } from 'class-validator';
import { VoteChoice } from '../../../generated/prisma/enums.js';

export class VotePollDto {
  @IsEnum(VoteChoice)
  choice!: VoteChoice;
}
