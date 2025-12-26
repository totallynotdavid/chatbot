# Getting a Permanent WhatsApp Access Token

Your current token expires quickly. Here's how to create a permanent system user token.

## Step-by-Step Guide

### 1. Go to Business Settings
Navigate to: **[Meta Business Settings](https://business.facebook.com/settings)**

### 2. Create a System User
1. Click **"System users"** in the left sidebar (under Users section)
2. Click the **"Add"** button (top right)
3. Fill in details:
   - **System user name**: `WhatsApp Bot - Totem` (or any name you prefer)
   - **System user role**: Select **Admin** (for full control)
4. Click **"Create system user"**

### 3. Assign Assets to System User
1. Select your newly created system user
2. Click **"Assign assets"** button
3. In the **Apps** tab:
   - Find your WhatsApp app
   - Toggle **"Manage app"** under **"Full control"**
4. In the **WhatsApp accounts** tab:
   - Find your WhatsApp Business Account
   - Toggle **"Manage WhatsApp Business Accounts"** under **"Full control"**
5. Click **"Assign assets"**

### 4. Generate the Permanent Token
1. Still on the system user page, click **"Generate token"** button
2. Select your app from the dropdown
3. **Add these permissions** (check each one):
   - ✅ `business_management`
   - ✅ `whatsapp_business_messaging`
   - ✅ `whatsapp_business_management`
4. Set token expiration: **"Never"** (or 60 days for extra security)
5. Click **"Generate token"**
6. **Copy the token immediately** - you won't see it again!

### 5. Update Your .env File

Replace the temporary token in your `.env`:

```bash
# Old (temporary token - expires quickly)
WHATSAPP_TOKEN=EAAU1PV9Um6UBQY3J8F1BqBkRd9e...

# New (permanent system user token)
WHATSAPP_TOKEN=<YOUR_PERMANENT_TOKEN_HERE>
```

### 6. Test the New Token

Run the test script:
```bash
# Test sending a message with the new token
curl 'https://graph.facebook.com/v23.0/951170611408466/messages' \
-H 'Content-Type: application/json' \
-H 'Authorization: Bearer <YOUR_NEW_TOKEN>' \
-d '{
  "messaging_product": "whatsapp",
  "to": "<YOUR_TEST_PHONE>",
  "type": "text",
  "text": {
    "body": "Testing permanent token!"
  }
}'
```

Or restart your backend and send a WhatsApp message to test.

## Important Notes

### Token Security
- ⚠️ **Never commit tokens to git**
- ⚠️ **Keep .env in .gitignore**
- ⚠️ **Store in secure secret management for production**

### Token Expiration Options
- **Never**: Token never expires (best for bots)
- **60 days**: More secure, requires rotation every 2 months
- **Custom**: Set your own expiration

### If You Lose the Token
1. Go back to system user
2. Click "Generate new token"
3. Follow same steps
4. Old token becomes invalid

## Verification

After updating, check the token works:

```bash
# Check token info
curl -X GET "https://graph.facebook.com/v23.0/debug_token?input_token=<YOUR_TOKEN>&access_token=<YOUR_TOKEN>"
```

Should return:
```json
{
  "data": {
    "app_id": "YOUR_APP_ID",
    "type": "USER",
    "is_valid": true,
    "scopes": [
      "business_management",
      "whatsapp_business_messaging",
      "whatsapp_business_management"
    ],
    "expires_at": 0  // 0 means never expires
  }
}
```

## Production Checklist

Before going live:
- [ ] Created system user with proper name
- [ ] Assigned all necessary assets
- [ ] Generated token with correct permissions
- [ ] Token set to "Never" expire (or rotation plan in place)
- [ ] Token stored securely (not in git)
- [ ] Tested token works
- [ ] Backup token stored in password manager
- [ ] Team has access to regenerate if needed
- [ ] Old temporary token documented for reference

## Troubleshooting

### "Invalid OAuth access token"
- Token expired or incorrectly copied
- Regenerate and update .env

### "Permission denied"
- System user doesn't have correct asset assignments
- Check both app AND WhatsApp account are assigned

### "Token not found"
- System user was deleted
- Recreate system user and token

## Next Steps

Once you have your permanent token:
1. ✅ Update `.env` file
2. ✅ Restart backend: `bun run dev:backend`
3. ✅ Test by sending WhatsApp message
4. ✅ Store backup of token securely
5. ✅ Document in team password manager
