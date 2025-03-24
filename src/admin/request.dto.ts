import { IsNotEmpty, IsNumber } from "class-validator"

export class PaginationParams {
    page: string
    perPage: string
}

export class ListParams {
    pagination: PaginationParams
    sort: {
        field: string
        order: "ASC" | "DESC"
    }
    filter?: any
    target?: string
    id?: string
}

export class GetManyParams {
    ids: any[]
}

export class ListResDto<T> {
    count: number
    list: T
}

export class ListReferenceParams extends ListParams {
    target: string
    id: string
}

export class DeleteParams {
    @IsNumber()
    @IsNotEmpty()
    id: number
    meta?: any
    previousData?: any
}

export class FindOneParam {
    id: string
}

export class ReqUpdateParam {
    id: string
}
