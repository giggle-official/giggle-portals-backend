# Widget Subscription Credit API

This document describes the APIs for managing widget subscription credits.

## Authentication

All endpoints require a **Widget JWT** token in the Authorization header:

```
Authorization: Bearer <widget_jwt>
```

---

## 1. Update Widget Subscription

Create or update a user's subscription and issue subscription credits.

### Endpoint

```
POST /api/v1/credit/update-widget-subscriptions
```

### Request Body

| Field                                       | Type    | Required | Description                                                               |
| ------------------------------------------- | ------- | -------- | ------------------------------------------------------------------------- |
| `user_id`                                   | string  | Yes      | The user's `username_in_be` (can be obtained from `/api/v1/user/profile`) |
| `subscription_detail`                       | object  | Yes      | Subscription metadata                                                     |
| `subscription_detail.product_name`          | string  | Yes      | Name of the subscription product                                          |
| `subscription_detail.period_start`          | string  | Yes      | ISO 8601 date when subscription period starts                             |
| `subscription_detail.period_end`            | string  | Yes      | ISO 8601 date when subscription period ends                               |
| `subscription_detail.cancel_at_period_end`  | boolean | Yes      | Whether to cancel subscription at period end                              |
| `subscription_detail.subscription_metadata` | object  | Yes      | Custom metadata for the subscription                                      |
| `subscription_credits`                      | array   | Yes      | Array of credits to issue (can be empty)                                  |
| `subscription_credits[].amount`             | number  | Yes      | Credit amount (positive integer)                                          |
| `subscription_credits[].issue_date`         | string  | Yes      | ISO 8601 date when credits become available                               |
| `subscription_credits[].expire_date`        | string  | Yes      | ISO 8601 date when credits expire                                         |

### Example Request

```json
{
    "user_id": "user_abc123",
    "subscription_detail": {
        "product_name": "Premium Plan",
        "period_start": "2025-01-01T00:00:00.000Z",
        "period_end": "2025-12-31T23:59:59.000Z",
        "cancel_at_period_end": false,
        "subscription_metadata": {
            "plan_type": "yearly",
            "price": 99.99
        }
    },
    "subscription_credits": [
        {
            "amount": 1000,
            "issue_date": "2025-01-01T00:00:00.000Z",
            "expire_date": "2025-12-31T23:59:59.000Z"
        },
        {
            "amount": 1000,
            "issue_date": "2026-01-01T00:00:00.000Z",
            "expire_date": "2026-12-31T23:59:59.000Z"
        }
    ]
}
```

### Response

```json
{
    "success": true
}
```

### Behavior

-   If the user has no existing subscription for your widget, a new subscription is created
-   If the user already has a subscription, the subscription details are updated
-   Credits with `issue_date` <= current date are issued immediately (added to user balance)
-   Credits with future `issue_date` are stored and will be issued automatically at midnight on the issue date
-   Each user can only have **one subscription per widget**

### Error Responses

| Status | Message                                         | Description                            |
| ------ | ----------------------------------------------- | -------------------------------------- |
| 400    | `User not found`                                | The specified `user_id` does not exist |
| 400    | `Issue date cannot be greater than expire date` | Invalid date range                     |

---

## 2. Cancel Widget Subscription

Cancel a user's subscription and remove all unissued credits.

### Endpoint

```
POST /api/v1/credit/cancel-widget-subscription
```

### Request Body

| Field     | Type   | Required | Description                 |
| --------- | ------ | -------- | --------------------------- |
| `user_id` | string | Yes      | The user's `username_in_be` |

### Example Request

```json
{
    "user_id": "user_abc123"
}
```

### Response

```json
{
    "success": true
}
```

### Behavior

-   Deletes the subscription record (allows user to subscribe again later)
-   Removes all **unissued** credits (`is_issue: false`)
-   **Leaves issued credits as-is** - they will expire naturally on their `expire_date`

### Error Responses

| Status | Message                  | Description                                     |
| ------ | ------------------------ | ----------------------------------------------- |
| 400    | `Subscription not found` | No subscription exists for this user and widget |

---

## Getting User ID

To get a user's `user_id` (`username_in_be`), call the user profile endpoint:

```
GET /api/v1/user/profile
Authorization: Bearer <user_jwt>
```

Response includes:

```json
{
  "usernameShorted": "user_abc123",
  ...
}
```

Use the `usernameShorted` value as the `user_id` in subscription APIs.

---

## Credit Lifecycle

```
┌─────────────────┐     issue_date      ┌─────────────────┐     expire_date     ┌─────────────────┐
│   Not Issued    │ ─────────────────▶  │     Issued      │ ─────────────────▶  │     Expired     │
│  (is_issue=0)   │   (added to user    │  (is_issue=1)   │   (balance set     │  (balance=0)    │
│                 │      balance)       │                 │      to 0)         │                 │
└─────────────────┘                     └─────────────────┘                     └─────────────────┘
        │                                       │
        │ cancel subscription                   │ consume
        ▼                                       ▼
   ┌─────────┐                           ┌─────────────┐
   │ Deleted │                           │  Consumed   │
   └─────────┘                           │ (balance-=) │
                                         └─────────────┘
```

### Automatic Processing (Daily at Midnight)

1. **Expire**: Credits past their `expire_date` have remaining balance deducted from user
2. **Issue**: Credits with `issue_date` <= today are issued and added to user balance
