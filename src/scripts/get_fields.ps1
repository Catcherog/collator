# Requires FEISHU_BASE_APP_TOKEN and FEISHU_TABLE_ID environment variables.
# Fails closed if missing; never echoes the values.
if (-not $env:FEISHU_BASE_APP_TOKEN) {
  throw "FEISHU_BASE_APP_TOKEN is required"
}
if (-not $env:FEISHU_TABLE_ID) {
  throw "FEISHU_TABLE_ID is required"
}
lark-cli base +field-list --base-token $env:FEISHU_BASE_APP_TOKEN --table-id $env:FEISHU_TABLE_ID --as user
