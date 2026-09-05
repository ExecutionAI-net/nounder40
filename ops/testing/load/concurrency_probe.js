// Isolates process-level serialization from endpoint cost.
//
// /api/health/ is one trivial query. If its latency still balloons as VUs rise,
// the bottleneck is the server process, not the endpoint — which is the whole
// question for a prod tier that runs a single daphne process.

import http from 'k6/http'
import { Trend } from 'k6/metrics'

const BASE = __ENV.BASE || 'http://172.19.0.4:8001'
const PATH = __ENV.PATH_UNDER_TEST || '/api/health/'

const d = new Trend('health_latency', true)

export const options = {
  scenarios: {
    step: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 200,
      maxVUs: 400,
      stages: [
        { duration: '20s', target: 10 },
        { duration: '20s', target: 50 },
        { duration: '20s', target: 100 },
        { duration: '20s', target: 200 },
        { duration: '20s', target: 400 },
      ],
    },
  },
  thresholds: {},
}

export default function () {
  const r = http.get(`${BASE}${PATH}`)
  d.add(r.timings.duration)
}
