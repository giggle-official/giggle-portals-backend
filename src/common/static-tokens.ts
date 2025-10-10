//old token backs
export interface StaticTokens {
    env: string
    ip_id: number
    token: string
    old_info: {
        token_info: any
        current_token_info: any
    }
    new_info: {
        enable_buyback: boolean
        token_info: any
        current_token_info: any
    }
}

export const STATIC_TOKENS: StaticTokens[] = [
    {
        env: "dev",
        ip_id: 536,
        token: "A6hf3WZEpfjCG8DQvrVaNRDb8p4DR2j81vSFuyw1LAKV",
        old_info: {
            token_info: {
                version: "v3",
                user_address: "HHfLyddQFZF7fbwuNJJWEWiKic3nRimYQHDtQvCiuyLc",
                mint: "A6hf3WZEpfjCG8DQvrVaNRDb8p4DR2j81vSFuyw1LAKV",
                bonding_curve: "7fyKTfBgBcvLrZ8kqVggWXT42rd55cL8bVrSKeWRK54P",
                bonding_curve_progress: 0,
                name: "moon",
                symbol: "moon",
                price: "0.000000519090909",
                market_cap: "519.09",
                circulating_supply: "0",
                total_supply: "1000000000",
                cover_url: "https://giggle.mypinata.cloud/ipfs/QmWEeV1nsm8qJttShSuca59zQqn1XwdR9YZZpZpSaQqNQs",
                file_url: "",
                twitter: "",
                telegram: "",
                website: "",
                status: "completed",
                signature: "4fFD8pxPSJqm3bqGoErrYXo8kPop53vtG8RTVk8rRFLfuwGBbq8rDccifksDGxux8dZ7n9X5jXzUEStJkCWor29n",
                description: "moon",
                metadata_uri: "https://giggle.mypinata.cloud/ipfs/QmcxHXHZejfUjRwMWZeuuZxxvtUbAjoht5FKp38QqSayTM",
                sequels_amount: "0",
                created_at: "2025-09-01T11:10:41.015Z",
                updated_at: "2025-09-01T11:10:55.9Z",
                visitLink: "https://front-v2.giggletest.dev/orbitans?mint=A6hf3WZEpfjCG8DQvrVaNRDb8p4DR2j81vSFuyw1LAKV",
            },
            current_token_info: {
                version: "v3",
                userAddress: "HHfLyddQFZF7fbwuNJJWEWiKic3nRimYQHDtQvCiuyLc",
                name: "moon",
                mint: "A6hf3WZEpfjCG8DQvrVaNRDb8p4DR2j81vSFuyw1LAKV",
                symbol: "moon",
                marketCap: "1898.25",
                description: "moon",
                fileUrl: "",
                coverUrl: "https://giggle.mypinata.cloud/ipfs/QmWEeV1nsm8qJttShSuca59zQqn1XwdR9YZZpZpSaQqNQs",
                twitter: "",
                telegram: "",
                website: "",
                price: "0.0000018982512667",
                on_exchange: false,
                change5m: "0",
                change1h: "0",
                change24h: "0",
                bondingCurveProgress: 0.3467971076822061,
                lastTradingTime: 0,
                tradeVolume: "532492633.657042",
                totalSupply: "1000000000",
                tradingUri:
                    "https://front-v2.giggletest.dev/orbitans?mint=A6hf3WZEpfjCG8DQvrVaNRDb8p4DR2j81vSFuyw1LAKV",
                playerUri:
                    "https://front-v2.giggletest.dev/listPlayer?mint=A6hf3WZEpfjCG8DQvrVaNRDb8p4DR2j81vSFuyw1LAKV",
                site: "plugin",
                poolType: "",
                poolAddress: "",
                trade24hSol: "14.45402",
                credit_price: 500,
                file_url: "",
                cover_url: "https://giggle.mypinata.cloud/ipfs/QmWEeV1nsm8qJttShSuca59zQqn1XwdR9YZZpZpSaQqNQs",
                market_cap: "1898.25",
                visitLink: "https://front-v2.giggletest.dev/orbitans?mint=A6hf3WZEpfjCG8DQvrVaNRDb8p4DR2j81vSFuyw1LAKV",
            },
        },
        new_info: {
            enable_buyback: false,
            token_info: {
                version: "v3",
                user_address: "CGvh7rub99xN5XNh4W5EC3njhPRUPYDB17majF44cXKu",
                mint: "4iGz2ereVGDFDBbiXqyCB6zZMr7GTTMdqpPSpJrHA68q",
                bonding_curve: "",
                bonding_curve_progress: 0,
                name: "X2C Platform Token",
                symbol: "X2C",
                price: "0.01",
                market_cap: (1000000000 * 0.01).toString(),
                circulating_supply: "0",
                total_supply: "1000000000",
                cover_url: "https://ipfs.filebase.io/ipfs/QmXHJeCoBb6kivPwepaAgqMLmJftpf59RxisZq1dJjjFWX",
                file_url: "",
                twitter: "https://x.com/X2C_Official",
                telegram: "",
                website: "https://x2c.hk",
                status: "completed",
                signature: "5VjtVctfMpyNqZy6vFnifs6X2qzWLA3ZU4bC6QwKdYxuCKBFzocEBNwtWjBbSzNyhYHktH7fwsxWocZpBjtEJfuD",
                description: "moon",
                metadata_uri: "https://ipfs.filebase.io/ipfs/QmdutGWnsuFkcYVnrdt2mTrWAvZMpDKhsX7UGsdkrYBmkp",
                sequels_amount: "0",
                created_at: "2025-09-01T11:10:41.015Z",
                updated_at: "2025-09-01T11:10:55.9Z",
                visitLink: "",
            },
            current_token_info: {
                version: "v3",
                userAddress: "CGvh7rub99xN5XNh4W5EC3njhPRUPYDB17majF44cXKu",
                name: "X2C Platform Token",
                mint: "4iGz2ereVGDFDBbiXqyCB6zZMr7GTTMdqpPSpJrHA68q",
                symbol: "X2C",
                marketCap: (1000000000 * 0.01).toString(),
                description:
                    "X2C is the platform token of the AIGC Content Exchange, enabling buy-back, creator rewards, and governance across the Giggle ecosystem.",
                fileUrl: "",
                coverUrl: "https://ipfs.filebase.io/ipfs/QmXHJeCoBb6kivPwepaAgqMLmJftpf59RxisZq1dJjjFWX",
                twitter: "https://x.com/X2C_Official",
                telegram: "",
                website: "https://x2c.hk",
                price: "0.01",
                on_exchange: false,
                change5m: "0",
                change1h: "0",
                change24h: "0",
                bondingCurveProgress: 0,
                lastTradingTime: 0,
                tradeVolume: (1000000000 * 0.01).toString(),
                totalSupply: "1000000000",
                tradingUri:
                    "https://front-v2.giggletest.dev/orbitans?mint=4iGz2ereVGDFDBbiXqyCB6zZMr7GTTMdqpPSpJrHA68q",
                playerUri:
                    "https://front-v2.giggletest.dev/listPlayer?mint=4iGz2ereVGDFDBbiXqyCB6zZMr7GTTMdqpPSpJrHA68q",
                site: "plugin",
                poolType: "",
                poolAddress: "",
                trade24hSol: "0",
                credit_price: 500,
                file_url: "",
                cover_url: "https://ipfs.filebase.io/ipfs/QmXHJeCoBb6kivPwepaAgqMLmJftpf59RxisZq1dJjjFWX",
                market_cap: (1000000000 * 0.01).toString(),
                visitLink: "https://front-v2.giggletest.dev/orbitans?mint=4iGz2ereVGDFDBbiXqyCB6zZMr7GTTMdqpPSpJrHA68q",
            },
        },
    },
]
