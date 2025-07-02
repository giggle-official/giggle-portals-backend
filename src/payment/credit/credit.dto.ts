import { IsInt, IsNotEmpty, IsNumber, Min } from "class-validator"

export class TopUpDto {
    @IsNotEmpty()
    @IsNumber()
    @IsInt()
    @Min(500)
    amount: number
}
