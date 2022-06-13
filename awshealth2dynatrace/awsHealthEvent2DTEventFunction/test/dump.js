const fs = require('fs')
const transformer = require('../transformer.js')
const { Liquid } = require('liquidjs')
const engine = new Liquid()
const assert = require('assert')

const TEST_DUMP_PATH = process.env.TEST_DUMP_PATH

function dump (sample, type, payload) {
  console.log(`------ ${sample}_${type}`)
  console.log(JSON.stringify(payload))
  console.log(payload)
  if (TEST_DUMP_PATH !== undefined) {
    fs.writeFileSync(`${TEST_DUMP_PATH}/${sample}_${type}.json`, JSON.stringify(payload))
  }
}

function awsEvent2AWSPutEventsPayload (awsEvent) {
  assert.ok(process.env.AWS_EVENTBRIDGE_BUS !== undefined, 'env[AWS_EVENTBRIDGE_BUS] not set; fix test setup')

  return [{
    DetailType: awsEvent['detail-type'],
    Source: awsEvent.source,
    Resources: awsEvent.resources,
    EventBusName: process.env.AWS_EVENTBRIDGE_BUS,
    Detail: JSON.stringify(awsEvent.detail)
  }]
}

const SAMPLE1 = 'AWSHealthEvent1'
const SAMPLE2 = 'AWSHealthEvent2'

describe('transformer', function () {
  it('transformation sample 1', function () {
    assert.ok(process.env.TEST_AWS_REGION !== undefined, 'env[TEST_AWS_REGION] not set; fix test setup')
    assert.ok(process.env.TEST_AWS_ACCOUNT !== undefined, 'env[TEST_AWS_ACCOUNT] not set; fix test setup')

    const awsEventTemplate = new String(fs.readFileSync(`./test/data/${SAMPLE1}.json`))
    const compiledAwsEventTemplate = engine.parse(awsEventTemplate)
    const awsEvent = JSON.parse(engine.renderSync(compiledAwsEventTemplate,
      {
        region: process.env.TEST_AWS_REGION,
        account: process.env.TEST_AWS_ACCOUNT,
        startTime: new Date()
      }))

    dump(SAMPLE1, 'fullEventBridgeMessage', awsEvent)
    dump(SAMPLE1, 'toEventBridgeManualDump', awsEvent.detail)
    dump(SAMPLE1, 'toEventBridgeThroughAPI', awsEvent2AWSPutEventsPayload(awsEvent))
    dump(SAMPLE1, 'toDynatraceThroughAPI', transformer.transform2DTEvent(awsEvent))
  })

  it('transformation sample 2', function () {
    assert.ok(process.env.TEST_AWS_REGION !== undefined, 'env[TEST_AWS_REGION] not set; fix test setup')
    assert.ok(process.env.TEST_AWS_ACCOUNT !== undefined, 'env[TEST_AWS_ACCOUNT] not set; fix test setup')
    assert.ok(process.env.TEST1_AWS_EC2_INSTANCE !== undefined, 'env[TEST1_AWS_EC2_INSTANCE] not set; fix test setup')

    const awsEventTemplate = new String(fs.readFileSync('./test/data/AWSHealthEvent2.json'))
    const compiledAwsEventTemplate = engine.parse(awsEventTemplate)
    const awsEvent = JSON.parse(engine.renderSync(compiledAwsEventTemplate,
      {
        region: process.env.TEST_AWS_REGION,
        account: process.env.TEST_AWS_ACCOUNT,
        instance: process.env.TEST1_AWS_EC2_INSTANCE,
        startTime: new Date()
      }))

    dump(SAMPLE2, 'fullEventBridgeMessage', awsEvent)
    dump(SAMPLE2, 'toEventBridgeManualDump', awsEvent.detail)
    dump(SAMPLE2, 'toEventBridgeThroughAPI', awsEvent2AWSPutEventsPayload(awsEvent))
    dump(SAMPLE2, 'toDynatraceThroughAPI', transformer.transform2DTEvent(awsEvent))
  })
})
