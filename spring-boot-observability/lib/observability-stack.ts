import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import { DockerImageAsset } from 'aws-cdk-lib/aws-ecr-assets';
import * as path from 'path';
import { Construct } from 'constructs';

export class ObservabilityStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ==================== VPC ====================
    const vpc = new ec2.Vpc(this, 'ObservabilityVpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    // ==================== ECS CLUSTER ====================
    const cluster = new ecs.Cluster(this, 'ObservabilityCluster', {
      vpc,
      clusterName: 'observability-cluster',
      defaultCloudMapNamespace: {
        name: 'local',
        type: servicediscovery.NamespaceType.DNS_PRIVATE,
      },
    });

    // ==================== IAM ROLES ====================
    const taskExecutionRole = new iam.Role(this, 'TaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // ==================== SPRING BOOT APP ====================
    const springBootLogGroup = new logs.LogGroup(this, 'SpringBootLogGroup', {
      logGroupName: '/ecs/spring-boot-app',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const springBootImage = new DockerImageAsset(this, 'SpringBootImage', {
      directory: path.join(__dirname, '../spring-boot-app'),
    });

    const springBootTaskDef = new ecs.FargateTaskDefinition(this, 'SpringBootTaskDef', {
      memoryLimitMiB: 512,
      cpu: 256,
      executionRole: taskExecutionRole,
      taskRole: taskRole,
    });

    const springBootContainer = springBootTaskDef.addContainer('SpringBootContainer', {
      image: ecs.ContainerImage.fromDockerImageAsset(springBootImage),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'spring-boot',
        logGroup: springBootLogGroup,
      }),
      environment: {
        SPRING_PROFILES_ACTIVE: 'prod',
        SERVER_PORT: '8080',
      },
    });

    springBootContainer.addPortMappings({
      containerPort: 8080,
      protocol: ecs.Protocol.TCP,
    });

    const springBootService = new ecs.FargateService(this, 'SpringBootService', {
      cluster,
      taskDefinition: springBootTaskDef,
      desiredCount: 2,
      assignPublicIp: false,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      cloudMapOptions: {
        name: 'springboot',
        dnsRecordType: servicediscovery.DnsRecordType.A,
      },
    });

    // Spring Boot ALB
    const springBootALB = new elbv2.ApplicationLoadBalancer(this, 'SpringBootALB', {
      vpc,
      internetFacing: true,
      loadBalancerName: 'spring-boot-alb',
    });

    const springBootListener = springBootALB.addListener('SpringBootListener', {
      port: 80,
      open: true,
    });

    springBootListener.addTargets('SpringBootTarget', {
      port: 8080,
      targets: [springBootService],
      healthCheck: {
        path: '/actuator/health',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
    });

    // ==================== PROMETHEUS ====================
    const prometheusLogGroup = new logs.LogGroup(this, 'PrometheusLogGroup', {
      logGroupName: '/ecs/prometheus',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const prometheusImage = new DockerImageAsset(this, 'PrometheusImage', {
      directory: path.join(__dirname, '../prometheus'),
    });

    const prometheusTaskDef = new ecs.FargateTaskDefinition(this, 'PrometheusTaskDef', {
      memoryLimitMiB: 512,
      cpu: 256,
      executionRole: taskExecutionRole,
    });

    const prometheusContainer = prometheusTaskDef.addContainer('PrometheusContainer', {
      image: ecs.ContainerImage.fromDockerImageAsset(prometheusImage),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'prometheus',
        logGroup: prometheusLogGroup,
      }),
    });

    prometheusContainer.addPortMappings({
      containerPort: 9090,
      protocol: ecs.Protocol.TCP,
    });

    const prometheusService = new ecs.FargateService(this, 'PrometheusService', {
      cluster,
      taskDefinition: prometheusTaskDef,
      desiredCount: 1,
      assignPublicIp: false,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      cloudMapOptions: {
        name: 'prometheus',
        dnsRecordType: servicediscovery.DnsRecordType.A,
      },
    });

    // Allow Prometheus to scrape Spring Boot
    prometheusService.connections.allowTo(
      springBootService,
      ec2.Port.tcp(8080),
      'Prometheus scrapes Spring Boot metrics'
    );

    // ==================== GRAFANA ====================
    const grafanaLogGroup = new logs.LogGroup(this, 'GrafanaLogGroup', {
      logGroupName: '/ecs/grafana',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const grafanaTaskDef = new ecs.FargateTaskDefinition(this, 'GrafanaTaskDef', {
      memoryLimitMiB: 1024,
      cpu: 512,
      executionRole: taskExecutionRole,
    });

    const grafanaContainer = grafanaTaskDef.addContainer('GrafanaContainer', {
      image: ecs.ContainerImage.fromRegistry('grafana/grafana:latest'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'grafana',
        logGroup: grafanaLogGroup,
      }),
      environment: {
        GF_SECURITY_ADMIN_USER: 'admin',
        GF_SECURITY_ADMIN_PASSWORD: 'admin123',
        GF_USERS_ALLOW_SIGN_UP: 'false',
        GF_SERVER_ROOT_URL: 'http://localhost:3000',
      },
    });

    grafanaContainer.addPortMappings({
      containerPort: 3000,
      protocol: ecs.Protocol.TCP,
    });

    const grafanaService = new ecs.FargateService(this, 'GrafanaService', {
      cluster,
      taskDefinition: grafanaTaskDef,
      desiredCount: 1,
      assignPublicIp: false,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
    });

    // Allow Grafana to query Prometheus
    grafanaService.connections.allowTo(
      prometheusService,
      ec2.Port.tcp(9090),
      'Grafana queries Prometheus'
    );

    // Grafana ALB
    const grafanaALB = new elbv2.ApplicationLoadBalancer(this, 'GrafanaALB', {
      vpc,
      internetFacing: true,
      loadBalancerName: 'grafana-alb',
    });

    const grafanaListener = grafanaALB.addListener('GrafanaListener', {
      port: 80,
      open: true,
    });

    grafanaListener.addTargets('GrafanaTarget', {
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [grafanaService],
      healthCheck: {
        path: '/api/health',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
      },
    });

    // ==================== OUTPUTS ====================
    new cdk.CfnOutput(this, 'SpringBootURL', {
      value: `http://${springBootALB.loadBalancerDnsName}`,
      description: 'Spring Boot Application URL',
    });

    new cdk.CfnOutput(this, 'SpringBootMetricsURL', {
      value: `http://${springBootALB.loadBalancerDnsName}/actuator/prometheus`,
      description: 'Spring Boot Prometheus Metrics',
    });

    new cdk.CfnOutput(this, 'GrafanaURL', {
      value: `http://${grafanaALB.loadBalancerDnsName}`,
      description: 'Grafana Dashboard (admin/admin123)',
    });

    new cdk.CfnOutput(this, 'PrometheusDataSourceURL', {
      value: 'http://prometheus.local:9090',
      description: 'Use this URL in Grafana for Prometheus datasource',
    });
  }
}
