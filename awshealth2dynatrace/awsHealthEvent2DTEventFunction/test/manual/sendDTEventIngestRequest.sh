#!/bin/bash
curl ${DT_API_URL}/api/v2/events/ingest -H "Content-Type: application/json" -H "Authorization: Api-Token ${DT_API_TOKEN}" -d@$1