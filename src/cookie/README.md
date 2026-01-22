# Cookie Service API

A service for extracting browser cookies from video platforms for use with yt-dlp.

## Supported Sites

| Site | URL |
|------|-----|
| `douyin` | https://www.douyin.com |
| `bilibili` | https://www.bilibili.com |
| `twitter` | https://x.com |

## Authentication

Use your developer JWT to access this API.

## API Endpoints

### Get Cookie Status

```
GET /api/v1/cookies
```

**Response:**
```json
{
  "success": true,
  "supported_sites": ["douyin", "bilibili", "twitter"],
  "data": [
    {
      "site_name": "douyin",
      "site_url": "https://www.douyin.com",
      "last_refresh": "2026-01-22T10:00:00.000Z",
      "refresh_status": "success",
      "error_message": null
    }
  ]
}
```

### Download Cookies File

```
GET /api/v1/cookies/:siteName
```

Returns a `.txt` file in Netscape cookie format.

**Parameters:**
- `siteName` - `douyin`, `bilibili`, or `twitter`

### Refresh Cookies (Single Site)

```
POST /api/v1/cookies/:siteName/refresh
```

**Response:**
```json
{
  "success": true,
  "message": "Successfully refreshed 15 cookies for douyin"
}
```

### Refresh Cookies (All Sites)

```
POST /api/v1/cookies/refresh-all
```

**Response:**
```json
{
  "success": true,
  "message": "Cookie refresh initiated for all sites"
}
```

## Usage with yt-dlp

```bash
# 1. Download cookies file
curl https://your-api-host/api/v1/cookies/douyin -o /tmp/douyin_cookies.txt

# 2. Use with yt-dlp
yt-dlp --cookies /tmp/douyin_cookies.txt "https://www.douyin.com/video/xxx"
```

## Auto Refresh

Cookies are automatically refreshed every hour.
