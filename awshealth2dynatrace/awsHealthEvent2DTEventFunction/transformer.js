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

const { Liquid } = require('liquidjs')
const engine = new Liquid()
const flatten = require('flat')

const DEFAULT_DT_EVENT_TIMEOUT = 60 * 24
const DEFAULT_LOCALE = 'en_US'
const DEFAULT_AWS_PARTITION = 'aws' // other values are aws-cn or aws-us-gov

const SERVICE_2_ENTITY_SELECTOR_MAPPINGS = {
  // confirmed
  "ec2": 'type("EC2_INSTANCE"),arn({{arns}})'
}

const SERVICE_2_ENTITYARN_MAPPINGS =
{
  // confirmed
  "ec2": "arn:{{partition}}:ec2:{{region}}:{{account}}:instance/{{resource}}"
}

function transform2DTEventType(awsEvent) {
  // possible to narrow AWS Event down to a more fine grained DT Event type
  switch (awsEvent.detail.eventTypeCategory) {
    case 'issue':
      return 'AVAILABILITY_EVENT'

    case 'accountNotification':
      return 'CUSTOM_ANNOTATION'

    case 'scheduledChange':
      return 'CUSTOM_ANNOTATION'

    default:
      throw new Error(`No mapping of eventTypeCategory: ${awsEvent.detail.eventTypeCategory} to DT Event Type defined`)
  }
}

function getEventDescriptionByLocale(eventDescription, locale) {
  const matches = eventDescription.filter(ed => ed.language === locale)
  if (matches.length === 1) {
    return matches[0].latestDescription
  } else if (matches.length === 0) {
    console.error('no eventDescription available, setting to -')
    return '-'
  } else {
    console.error('multiple eventDescription fields match locale, defaulting to 1st item')
    return matches[0].latestDescription
  }
}

function transform2DTTitle(awsEvent) {
  return `AWS Health: ${awsEvent.detail.eventTypeCategory}/${awsEvent.detail.eventTypeCode} impacting ${awsEvent.detail.service}: ${getEventDescriptionByLocale(awsEvent.detail.eventDescription, DEFAULT_LOCALE)}`
}

function transformTime2UTCMilliseconds(time) {
  return new Date(time).getTime()
}

function appendStartTime(eventIngestObj, awsEvent) {
  if (awsEvent?.detail?.startTime) {
    eventIngestObj.startTime = transformTime2UTCMilliseconds(awsEvent.detail.startTime)
  }
  return eventIngestObj
}

function appendEndTime(eventIngestObj, awsEvent) {
  if (awsEvent?.detail?.endTime) {
    eventIngestObj.endTime = transformTime2UTCMilliseconds(awsEvent.detail.endTime)
  }
  return eventIngestObj
}

function appendProperties(eventIngestObj, awsEvent) {
  eventIngestObj.properties = {
    ...eventIngestObj.properties,
    // no nested objects allowed in DT event.properties
    ...flatten(awsEvent)
  }

  // in case of eventIngestObj.properties.resources=[],
  // the flatten command not removing it; removing it manually
  if (eventIngestObj.properties.resources?.length === 0) {
    delete eventIngestObj.properties.resources
  }

  return eventIngestObj
}

function appendEntityARN2AffectedEntity(awsEvent, affectedEntity) {
  const template = service2EntityARN(awsEvent.detail.service)

  if (template) {
    const compiledTemplate = engine.parse(template)

    const arn = engine.renderSync(compiledTemplate, {
      partition: DEFAULT_AWS_PARTITION,
      service: awsEvent.detail.service,
      region: awsEvent.region,
      'account': awsEvent.account,
      'resource': affectedEntity.entityValue
    })

    affectedEntity.entityARN = arn
  } else {
    console.error(`no mapping to create entityARN for service '${awsEvent.detail.service}'; no entityARN added`)
  }
  return affectedEntity;
}

function appendEntityARNs2AffectedEntities(awsEvent) {
  if (awsEvent.detail.affectedEntities) {
    awsEvent.detail.affectedEntities = awsEvent.detail.affectedEntities.map(ae => appendEntityARN2AffectedEntity(awsEvent, ae))
  }
  return awsEvent
}

function appendEntitySelector(eventIngestObj, awsEvent) {
  if (awsEvent.detail.affectedEntities) {
    const entityArns = awsEvent.detail.affectedEntities.map(ae => ae.entityARN).filter(arn => arn !== undefined)

    const template = service2entitySelector(awsEvent.detail.service)
    if (template) {
      const compiledTemplate = engine.parse(template)
      eventIngestObj.entitySelector = engine.renderSync(compiledTemplate, { arns: entityArns.map(ea => `"${ea}"`).join(',') })
    } else {
      console.error(`no mapping to create entitySelector for service '${awsEvent.detail.service}'; event associated with AWS_CREDENTIALS`)
    }
  }
  return eventIngestObj
}

function service2entitySelector(service) {
  return SERVICE_2_ENTITY_SELECTOR_MAPPINGS[service.toLowerCase()]
}

function service2EntityARN(service) {
  return SERVICE_2_ENTITYARN_MAPPINGS[service.toLowerCase()]
}

function transform2DTEvent(awsEvent) {
  let eventIngestObj = {
    eventType: transform2DTEventType(awsEvent),
    title: transform2DTTitle(awsEvent),
    timeout: DEFAULT_DT_EVENT_TIMEOUT,
    entitySelector: `TYPE("AWS_CREDENTIALS"),awsAccountId("${awsEvent.account}")`,
    properties: {
      _type: 'awsHealthEvent'
    },
  }

  awsEvent = appendEntityARNs2AffectedEntities(awsEvent)
  eventIngestObj = appendStartTime(eventIngestObj, awsEvent)
  eventIngestObj = appendEndTime(eventIngestObj, awsEvent)
  eventIngestObj = appendEntitySelector(eventIngestObj, awsEvent)
  eventIngestObj = appendProperties(eventIngestObj, awsEvent)
  return eventIngestObj
}

module.exports.transform2DTEvent = transform2DTEvent