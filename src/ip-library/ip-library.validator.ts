import { ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments, isString } from "class-validator"
import { CreateIpDto } from "./ip-library.dto"
import { PrismaService } from "src/common/prisma.service"
import { Injectable } from "@nestjs/common"

@ValidatorConstraint({ async: true })
@Injectable()
export class IpNameValidator implements ValidatorConstraintInterface {
    constructor(private readonly prisma: PrismaService) {}

    async validate(obj: string, args: ValidationArguments) {
        const req = args.object as CreateIpDto
        const ip = await this.prisma.ip_library.findFirst({
            where: {
                name: req.name,
            },
        })
        //todo: add order check
        return !ip && req.name.length >= 1 && req.name.length <= 32
    }

    defaultMessage(args: ValidationArguments) {
        return "IP name already exists, ticker must not be USDC or USDT"
    }
}

@ValidatorConstraint({ async: true })
@Injectable()
export class TickerValidator implements ValidatorConstraintInterface {
    validate(obj: string, args: ValidationArguments) {
        const regex = /^[A-Za-z0-9]+$/
        return obj && isString(obj) && obj.toUpperCase() !== "USDC" && obj.toUpperCase() !== "USDT" && regex.test(obj)
    }

    defaultMessage(args: ValidationArguments) {
        return "Ticker must not be USDC or USDT and must contain only letters and numbers"
    }
}
