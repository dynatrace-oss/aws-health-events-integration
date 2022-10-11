// Copyright 2022 Dynatrace LLC

// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at

//     https://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

const PACKAGE_JSON = require('./package.json'); 

const transformer = require('./transformer.js')
const axios = require('axios').default;
const fs = require('fs')
const AWS = require('aws-sdk')

const DT_API_URL = process.env['DT_API_URL']
const DONT_SEND_TO_DT = process.env['DONT_SEND_TO_DT']
const IS_AWS_LAMBDA = !!process.env['LAMBDA_TASK_ROOT']
const AWS_SECRET_REGION = process.env['AWS_SECRET_REGION']
const AWS_SECRET_ID = process.env['AWS_SECRET_ID']
let DT_API_TOKEN = process.env['DT_API_TOKEN']

async function getAWSSecret() {
    const client = new AWS.SecretsManager({
        region: AWS_SECRET_REGION
    });

    const data = await client.getSecretValue({ SecretId: AWS_SECRET_ID }).promise()

    if ('SecretString' in data) {
        const secret = JSON.parse(data.SecretString).dtAPIToken
        if (secret === undefined) {
            throw new Error(`Secret ${AWS_SECRET_ID} could be fetched but it does not contain .dtAPIToken field`)
        }

        return secret
    } else {
        throw new Error(`No secret with ${AWS_SECRET_ID} found`)
    }
}

async function handler(event) {
    try {
        const dtEvent = transformer.transform2DTEvent(event)

        if (dtEvent.endTime === undefined) {
            if (DONT_SEND_TO_DT !== undefined) {
                console.log(`${event.id}: returning transformed health event only`)
                return dtEvent
            } else {
                console.log(`${event.id}: sending health event directly to Dynatrace`)
                await sendToDynatrace(dtEvent)
            }
        } else {
            console.log(`${event.id}: skipping event as event.endTime is set`)
        }
    } catch (e) {
        console.error(`${event.id}: an error occured - ${e}`)
    }
}

async function sendToDynatrace(dtEvent) {
    if (DT_API_URL === undefined) {
        throw new Error('env[DT_API_URL] not set; fix configuration')
    }

    if (DT_API_TOKEN === undefined) {
        console.log(`no DT_API_TOKEN supplied, fetching secrets from AWS SecretManager`)
        DT_API_TOKEN = await getAWSSecret()
    }

    try {
        ret = await axios.post(`${DT_API_URL}/api/v2/events/ingest`, JSON.stringify(dtEvent), {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Api-Token ${DT_API_TOKEN}`,
                'User-Agent': `awshealth2dynatrace/${PACKAGE_JSON.version}`
            }
        })
    } catch (e) {
        throw new Error(`error occured while interacting with DT, ${e.message}`)
    }

    if (ret.status < 200 || ret.status > 299) {
        throw new Error(`DT returned unexpected status code ${ret.status}/${ret?.request?.res?.statusMessage}`)
    }

    if (ret.data === undefined) {
        throw new Error('DT returning no payload')
    }

    const { reportCount, eventIngestResults } = ret.data
    if (reportCount === undefined || reportCount <= 0) {
        throw new Error(`DT returned unexpected status; expected reportCount=1, not ${reportCount}`)
    }

    if (eventIngestResults === undefined || !(eventIngestResults instanceof Array)) {
        throw new Error('DT returned unexpected status; eventIngestResults missing')
    }

    let failureDetected = false;
    for (let i in eventIngestResults) {
        const { correlationId, status } = eventIngestResults[i]
        if (status !== 'OK') {
            console.error(`DT returned unexpected status; eventIngestResults[${i}] status=${status} correlationId=${correlationId}`)
            failureDetected = true;
        } else {
            console.log(`Event successfully created, correlationId=${correlationId}`)
        }
    }

    if (failureDetected) {
        throw new Error('DT returned unexpected status, see above')
    }
}

exports.handler = handler

if (!IS_AWS_LAMBDA) {
    if (DT_API_TOKEN === undefined) {
        throw new Error('use the environment variable DT_API_TOKEN as the AWS secrets manager may not be accessible to you from local machine')
    }

    if (process.argv.length < 3) {
        console.error(`invalid arguments: ${process.argv[0]} ${process.argv[1]} <path to AWS Health Event file(s)>`)
    } else {
        const content = JSON.parse(fs.readFileSync(process.argv[2]))

        if (Array.isArray(content)) {
            content.forEach(handler)
        } else {
            handler(content)
        }
    }
}
