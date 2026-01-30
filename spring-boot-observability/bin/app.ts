#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ObservabilityStack } from '../lib/observability-stack';

const app = new cdk.App();

new ObservabilityStack(app, 'SpringBootObservabilityStack', {
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT, 
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1'
  },
});

app.synth();