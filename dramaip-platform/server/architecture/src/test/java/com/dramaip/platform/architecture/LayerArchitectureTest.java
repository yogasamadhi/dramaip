package com.dramaip.platform.architecture;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;

@AnalyzeClasses(packages = "com.dramaip.platform", importOptions = com.tngtech.archunit.core.importer.ImportOption.DoNotIncludeTests.class)
class LayerArchitectureTest {
    @ArchTest
    static final ArchRule controllersDoNotReachJdbc = noClasses().that().resideInAPackage("..controller..")
            .should().dependOnClassesThat().resideInAnyPackage("org.springframework.jdbc..");

    @ArchTest
    static final ArchRule commonDoesNotDependOnBusiness = noClasses().that().resideInAPackage("com.dramaip.platform.common..")
            .should().dependOnClassesThat().resideInAnyPackage(
                    "com.dramaip.platform.identity..", "com.dramaip.platform.notification..", "com.dramaip.platform.reporting..", "com.dramaip.platform.creation..",
                    "com.dramaip.platform.quota..", "com.dramaip.platform.ai..", "com.dramaip.platform.billing..");

    @ArchTest
    static final ArchRule identityDoesNotDependOnPeers = noClasses().that().resideInAPackage("com.dramaip.platform.identity..")
            .should().dependOnClassesThat().resideInAnyPackage("com.dramaip.platform.notification..", "com.dramaip.platform.reporting..", "com.dramaip.platform.creation..", "com.dramaip.platform.quota..", "com.dramaip.platform.ai..", "com.dramaip.platform.billing..");
    @ArchTest
    static final ArchRule notificationDoesNotDependOnPeers = noClasses().that().resideInAPackage("com.dramaip.platform.notification..")
            .should().dependOnClassesThat().resideInAnyPackage("com.dramaip.platform.identity..", "com.dramaip.platform.reporting..", "com.dramaip.platform.creation..", "com.dramaip.platform.quota..", "com.dramaip.platform.ai..", "com.dramaip.platform.billing..");
    @ArchTest
    static final ArchRule reportingDoesNotDependOnPeers = noClasses().that().resideInAPackage("com.dramaip.platform.reporting..")
            .should().dependOnClassesThat().resideInAnyPackage("com.dramaip.platform.identity..", "com.dramaip.platform.notification..", "com.dramaip.platform.creation..", "com.dramaip.platform.quota..", "com.dramaip.platform.ai..", "com.dramaip.platform.billing..");
    @ArchTest
    static final ArchRule creationDoesNotDependOnPeers = noClasses().that().resideInAPackage("com.dramaip.platform.creation..")
            .should().dependOnClassesThat().resideInAnyPackage("com.dramaip.platform.identity..", "com.dramaip.platform.notification..", "com.dramaip.platform.reporting..", "com.dramaip.platform.quota..", "com.dramaip.platform.ai..", "com.dramaip.platform.billing..");
    @ArchTest
    static final ArchRule quotaDoesNotDependOnPeers = noClasses().that().resideInAPackage("com.dramaip.platform.quota..")
            .should().dependOnClassesThat().resideInAnyPackage("com.dramaip.platform.identity..", "com.dramaip.platform.notification..", "com.dramaip.platform.reporting..", "com.dramaip.platform.creation..", "com.dramaip.platform.ai..", "com.dramaip.platform.billing..");
    @ArchTest
    static final ArchRule aiDoesNotDependOnPeers = noClasses().that().resideInAPackage("com.dramaip.platform.ai..")
            .should().dependOnClassesThat().resideInAnyPackage("com.dramaip.platform.identity..", "com.dramaip.platform.notification..", "com.dramaip.platform.reporting..", "com.dramaip.platform.creation..", "com.dramaip.platform.quota..", "com.dramaip.platform.billing..");
    @ArchTest
    static final ArchRule billingDoesNotDependOnPeers = noClasses().that().resideInAPackage("com.dramaip.platform.billing..")
            .should().dependOnClassesThat().resideInAnyPackage("com.dramaip.platform.identity..", "com.dramaip.platform.notification..", "com.dramaip.platform.reporting..", "com.dramaip.platform.creation..", "com.dramaip.platform.quota..", "com.dramaip.platform.ai..");
}
