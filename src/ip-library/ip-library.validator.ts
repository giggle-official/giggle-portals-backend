import {
    ValidatorConstraint,
    ValidatorConstraintInterface,
    ValidationArguments,
    isInt,
    isString,
} from "class-validator"
import { AuthorizationSettingsDto, CreateIpDto, IpPeriodDto, RevenueDistributionDto } from "./ip-library.dto"
import { PrismaService } from "src/common/prisma.service"
import { Injectable } from "@nestjs/common"

@ValidatorConstraint({ async: true })
export class IpPeriodValidator implements ValidatorConstraintInterface {
    validate(obj: IpPeriodDto, args: ValidationArguments) {
        const authSettings = args.object as AuthorizationSettingsDto
        if (authSettings.long_term_license) {
            return true
        }
        const startDate = new Date(obj.start_date)
        const endDate = new Date(obj.end_date)
        const minEndDate = new Date(startDate)
        minEndDate.setDate(startDate.getDate() + 30)
        return endDate >= minEndDate
    }

    defaultMessage(args: ValidationArguments) {
        return "End date must be greater than start date + 30 days when long_term_license is false"
    }
}

@ValidatorConstraint({ async: true })
export class RevenueDistributionValidator implements ValidatorConstraintInterface {
    validate(obj: RevenueDistributionDto, args: ValidationArguments) {
        const total = obj.licensor + obj.platform + obj.community + obj.treasury
        return (
            total === 100 &&
            obj.treasury >= 0 &&
            obj.platform >= 0 &&
            obj.community >= 0 &&
            obj.licensor >= 0 &&
            isInt(obj.treasury) &&
            isInt(obj.platform) &&
            isInt(obj.community) &&
            isInt(obj.licensor)
        )
    }

    defaultMessage(args: ValidationArguments) {
        return "The sum of licensor, platform, community, and treasury must be 100 and all the numbers must be positive"
    }
}

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
