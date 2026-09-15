import { IsNumber, IsOptional, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';

/** Body of POST /payments/orders. `amount` is MAJOR units (rupees) — see PaymentsService for the paise conversion at the Razorpay boundary. */
export class CreateOrderDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  purpose?: string;
}
