import { BadRequestException, ExecutionContext, ValidationError, ValidationPipe } from "@nestjs/common"

import { createParamDecorator } from "@nestjs/common"

export const RawBody = createParamDecorator((data: unknown, ctx: ExecutionContext): any => {
    const request = ctx.switchToHttp().getRequest()
    return request.body
})

export const ValidEventBody = () =>
    RawBody(
        new ValidationPipe({
            validateCustomDecorators: true,
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
            validationError: {
                target: false,
                value: false,
            },
            exceptionFactory: (errors: ValidationError[]) => {
                const e = getAllConstraints(errors)
                const message = e.join(", ")
                const error = {
                    message: message,
                    errors: e,
                }
                return new BadRequestException(error)
            },
        }),
    )

function getAllConstraints(errors: ValidationError[]): string[] {
    const constraints: string[] = []

    for (const error of errors) {
        if (error.constraints) {
            const constraintValues = Object.values(error.constraints)
            constraints.push(...constraintValues)
        }

        if (error.children) {
            const childConstraints = getAllConstraints(error.children)
            constraints.push(...childConstraints)
        }
    }

    return constraints
}
