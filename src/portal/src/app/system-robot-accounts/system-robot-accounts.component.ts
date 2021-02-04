import { Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { NewRobotComponent } from './new-robot/new-robot.component';
import { ViewTokenComponent } from './view-token/view-token.component';
import { RobotService } from "../../../ng-swagger-gen/services/robot.service";
import { Robot } from "../../../ng-swagger-gen/models/robot";
import { clone, DEFAULT_PAGE_SIZE } from "../../lib/utils/utils";
import { ClrDatagridStateInterface, ClrLoadingState } from "@clr/angular";
import { catchError, debounceTime, distinctUntilChanged, finalize, map, switchMap } from "rxjs/operators";
import { MessageHandlerService } from "../shared/message-handler/message-handler.service";
import {
  ACTION_RESOURCE_I18N_MAP,
  FrontRobot,
  NAMESPACE_ALL_PROJECTS,
  PermissionsKinds
} from "./system-robot-util";
import { ProjectsModalComponent } from "./projects-modal/projects-modal.component";
import { forkJoin, Observable, of, Subscription } from "rxjs";
import { FilterComponent } from "../../lib/components/filter/filter.component";
import { ProjectService } from "../../../ng-swagger-gen/services/project.service";
import { ConfirmationMessage } from "../shared/confirmation-dialog/confirmation-message";
import { ConfirmationButtons, ConfirmationState, ConfirmationTargets } from "../shared/shared.const";
import { ConfirmationDialogService } from "../shared/confirmation-dialog/confirmation-dialog.service";
import { HttpErrorResponse } from "@angular/common/http";
import { errorHandler } from "../../lib/utils/shared/shared.utils";
import { operateChanges, OperateInfo, OperationState } from "../../lib/components/operation/operate";
import { OperationService } from "../../lib/components/operation/operation.service";
import { Project } from "../../../ng-swagger-gen/models/project";
import { DomSanitizer } from "@angular/platform-browser";
import { TranslateService } from "@ngx-translate/core";
import { RobotPermission } from "../../../ng-swagger-gen/models";
const FIRST_PROJECTS_PAGE_SIZE: number = 100;
@Component({
  selector: 'system-robot-accounts',
  templateUrl: './system-robot-accounts.component.html',
  styleUrls: ['./system-robot-accounts.component.scss']
})
export class SystemRobotAccountsComponent implements OnInit, OnDestroy {
  i18nMap = ACTION_RESOURCE_I18N_MAP;
  pageSize: number = DEFAULT_PAGE_SIZE;
  currentPage: number = 1;
  total: number = 0;
  robots: FrontRobot[] = [];
  selectedRows: FrontRobot[] = [];
  loading: boolean = true;
  loadingData: boolean = false;
  addBtnState: ClrLoadingState = ClrLoadingState.DEFAULT;
  hasGetAllProjects: boolean = false;
  @ViewChild(NewRobotComponent)
  newRobotComponent: NewRobotComponent;
  @ViewChild(ViewTokenComponent)
  viewTokenComponent: ViewTokenComponent;
  @ViewChild(ProjectsModalComponent)
  projectsModalComponent: ProjectsModalComponent;
  @ViewChild(FilterComponent, {static: true})
  filterComponent: FilterComponent;
  searchSub: Subscription;
  searchKey: string;
  subscription: Subscription;
  constructor(private robotService: RobotService,
              private projectService: ProjectService,
              private msgHandler: MessageHandlerService,
              private operateDialogService: ConfirmationDialogService,
              private operationService: OperationService,
              private sanitizer: DomSanitizer,
              private translate: TranslateService,
  ) {}
  ngOnInit() {
    this.loadDataFromBackend();
    if (!this.searchSub) {
      this.searchSub = this.filterComponent.filterTerms.pipe(
          debounceTime(500),
          distinctUntilChanged(),
          switchMap(robotSearchName => {
            this.currentPage = 1;
            this.selectedRows = [];
            const queryParam: RobotService.ListRobotParams = {
              page: this.currentPage,
              pageSize: this.pageSize,
            };
            this.searchKey = robotSearchName;
            if (this.searchKey) {
              queryParam.q = encodeURIComponent(`name=~${this.searchKey}`);
            }
            this.loading = true;
            return  this.robotService.ListRobotResponse(queryParam)
                .pipe(finalize(() => {
                  this.loading = false;
                }));
          })).subscribe(response => {
        this.total = Number.parseInt(
            response.headers.get('x-total-count')
        );
        this.robots = response.body as Robot[];
        this.calculateProjects();
      }, error => {
        this.msgHandler.handleError(error);
      });
    }
    if (!this.subscription) {
      this.subscription = this.operateDialogService.confirmationConfirm$.subscribe(
          message => {
            if (
                message &&
                message.state === ConfirmationState.CONFIRMED &&
                message.source === ConfirmationTargets.ROBOT_ACCOUNT
            ) {
              this.deleteRobots(message.data);
            }
            if ( message.state === ConfirmationState.CONFIRMED &&
                message.source === ConfirmationTargets.ROBOT_ACCOUNT_ENABLE_OR_DISABLE) {
              this.operateRobot();
            }
          }
      );
    }
  }
  ngOnDestroy() {
    if (this.searchSub) {
      this.searchSub.unsubscribe();
      this.searchSub = null;
    }
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
  }
  loadDataFromBackend() {
    this.loadingData = true;
    this.addBtnState = ClrLoadingState.LOADING;
    this.projectService.listProjectsResponse({
      withDetail: false,
      page: 1,
      pageSize: FIRST_PROJECTS_PAGE_SIZE
    }).subscribe(result => {
      // Get total count
      if (result.headers) {
        const xHeader: string = result.headers.get("X-Total-Count");
        const totalCount = parseInt(xHeader, 0);
        if (totalCount <= FIRST_PROJECTS_PAGE_SIZE) { // already gotten all projects
          if (this.newRobotComponent && this.newRobotComponent.listAllProjectsComponent) {
            this.newRobotComponent.listAllProjectsComponent.cachedAllProjects = result.body;
          }
          if (this.projectsModalComponent) {
            this.projectsModalComponent.cachedAllProjects = result.body;
          }
          this.loadingData = false;
          this.addBtnState = ClrLoadingState.ERROR;
        } else { // get all the projects in specified times
          const times: number = Math.ceil(totalCount / FIRST_PROJECTS_PAGE_SIZE);
          const observableList: Observable<Project[]>[] = [];
          for (let i = 1; i <= times; i++) {
            observableList.push( this.projectService.listProjects({
              withDetail: false,
              page: i,
              pageSize: FIRST_PROJECTS_PAGE_SIZE
            }));
          }
          forkJoin(observableList)
              .pipe(finalize(() => {
            this.loadingData = false;
            this.addBtnState = ClrLoadingState.ERROR;
          })).subscribe(res => {
            if (res && res.length) {
              let arr = [];
              res.forEach(item => {
                arr = arr.concat(item);
              });
              if (this.newRobotComponent && this.newRobotComponent.listAllProjectsComponent) {
                this.newRobotComponent.listAllProjectsComponent.cachedAllProjects = arr;
              }
              if (this.projectsModalComponent) {
                this.projectsModalComponent.cachedAllProjects = arr;
              }
            }
          });
        }
      }
    }, error => {
      this.loadingData = false;
      this.addBtnState = ClrLoadingState.ERROR;
    });
  }
  clrLoad(state?: ClrDatagridStateInterface) {
    if (state && state.page && state.page.size) {
      this.pageSize = state.page.size;
    }
    this.selectedRows = [];
    const queryParam: RobotService.ListRobotParams = {
      page: this.currentPage,
      pageSize: this.pageSize,
    };
    if (this.searchKey) {
      queryParam.q = encodeURIComponent(`name=~${this.searchKey}`);
    }
    this.loading = true;
    this.robotService.ListRobotResponse(queryParam)
        .pipe(finalize(() => this.loading = false))
        .subscribe(
            response => {
              this.total = Number.parseInt(
                  response.headers.get('x-total-count')
              );
              this.robots = response.body as Robot[];
              this.calculateProjects();
            },
            err => {
              this.msgHandler.error(err);
            });
  }
  openNewRobotModal(isEditMode: boolean) {
    if (isEditMode) {
      this.newRobotComponent.resetForEdit(clone(this.selectedRows[0]));
    } else {
      this.newRobotComponent.reset();
    }
  }
  openTokenModal() {
    this.viewTokenComponent.open();
    this.viewTokenComponent.robot = clone(this.selectedRows[0]);
  }
  calculateProjects() {
    if (this.robots && this.robots.length) {
      for (let i = 0 ; i < this.robots.length; i++) {
        if (this.robots[i] && this.robots[i].permissions && this.robots[i].permissions.length) {
          for (let j = 0 ; j < this.robots[i].permissions.length; j++) {
            if (this.robots[i].permissions[j].kind === PermissionsKinds.PROJECT
            && this.robots[i].permissions[j].namespace === NAMESPACE_ALL_PROJECTS) {
              this.robots[i].permissionScope = {
                coverAll: true,
                access: this.robots[i].permissions[j].access
              };
              break;
            }
          }
        }
      }
    }
  }
  getProjects(r: FrontRobot): RobotPermission[] {
    const arr = [];
    if (r && r.permissions && r.permissions.length) {
      for (let i = 0 ; i < r.permissions.length; i++) {
        if (r.permissions[i].kind === PermissionsKinds.PROJECT
           ) {
          arr.push(r.permissions[i]);
        }
      }
    }
    return arr;
  }
  openProjectModal(permissions: RobotPermission[], robotName: string) {
    this.projectsModalComponent.projectsModalOpened = true;
    this.projectsModalComponent.robotName = robotName;
    this.projectsModalComponent.permissions = permissions;
  }
  refresh() {
    this.currentPage = 1;
    this.selectedRows = [];
    this.clrLoad();
  }
  deleteRobots(robots: Robot[]) {
    let observableLists: Observable<any>[] = [];
    if (robots && robots.length) {
      robots.forEach(item => {
        observableLists.push(this.deleteRobot(item));
      });
      forkJoin(...observableLists).subscribe(resArr => {
        let error;
        if (resArr && resArr.length) {
          resArr.forEach(item => {
            if (item instanceof HttpErrorResponse) {
              error = errorHandler(item);
            }
          });
        }
        if (error) {
          this.msgHandler.handleError(error);
        } else {
          this.msgHandler.showSuccess('SYSTEM_ROBOT.DELETE_ROBOT_SUCCESS');
        }
        this.refresh();
      });
    }
  }
  deleteRobot(robot: Robot): Observable<any> {
    let operMessage = new OperateInfo();
    operMessage.name = 'SYSTEM_ROBOT.DELETE_ROBOT';
    operMessage.data.id = robot.id;
    operMessage.state = OperationState.progressing;
    operMessage.data.name = robot.name;
    this.operationService.publishInfo(operMessage);
    return this.robotService.DeleteRobot({robotId: robot.id}).pipe(
        map(() => {
          operateChanges(operMessage, OperationState.success);
        }),
        catchError(error => {
          const message = errorHandler(error);
          operateChanges(operMessage, OperationState.failure, message);
          return of(error);
        })
    );
  }
  openDeleteRobotsDialog() {
    const robotNames = this.selectedRows.map(robot => robot.name).join(",");
    const deletionMessage = new ConfirmationMessage(
        "ROBOT_ACCOUNT.DELETION_TITLE",
        "ROBOT_ACCOUNT.DELETION_SUMMARY",
        robotNames,
        this.selectedRows,
        ConfirmationTargets.ROBOT_ACCOUNT,
        ConfirmationButtons.DELETE_CANCEL
    );
    this.operateDialogService.openComfirmDialog(deletionMessage);
  }

  disableOrEnable() {
    const title: string = this.selectedRows[0].disable ? "SYSTEM_ROBOT.ENABLE_TITLE" : "SYSTEM_ROBOT.DISABLE_TITLE";
    const summary: string = this.selectedRows[0].disable ? "SYSTEM_ROBOT.ENABLE_SUMMARY" : "SYSTEM_ROBOT.DISABLE_SUMMARY";
    const deletionMessage = new ConfirmationMessage(
        title,
        summary,
        this.selectedRows[0].name,
        this.selectedRows[0],
        ConfirmationTargets.ROBOT_ACCOUNT_ENABLE_OR_DISABLE,
        this.selectedRows[0].disable ? ConfirmationButtons.ENABLE_CANCEL : ConfirmationButtons.DISABLE_CANCEL
    );
    this.operateDialogService.openComfirmDialog(deletionMessage);
  }

  operateRobot() {
    const robot: Robot = clone(this.selectedRows[0]);
    const successMessage: string = robot.disable ? "SYSTEM_ROBOT.ENABLE_ROBOT_SUCCESSFULLY" : "SYSTEM_ROBOT.DISABLE_ROBOT_SUCCESSFULLY";
    robot.disable = !robot.disable;
    delete robot.secret;
    const opeMessage = new OperateInfo();
    opeMessage.name = robot.disable ? "SYSTEM_ROBOT.DISABLE_TITLE" : "SYSTEM_ROBOT.ENABLE_TITLE";
    opeMessage.data.id = robot.id;
    opeMessage.state = OperationState.progressing;
    opeMessage.data.name = robot.name;
    this.operationService.publishInfo(opeMessage);
    this.robotService.UpdateRobot({
      robot: robot,
      robotId: robot.id
    }).subscribe( res => {
            operateChanges(opeMessage, OperationState.success);
            this.msgHandler.showSuccess(successMessage);
            this.refresh();
    }, error => {
      operateChanges(opeMessage, OperationState.failure, errorHandler(error));
      this.msgHandler.showSuccess(error);
    });
  }
  addSuccess(robot: Robot) {
    if (robot) {
      this.viewTokenComponent.open();
      this.viewTokenComponent.tokenModalOpened = false;
      this.viewTokenComponent.robot = clone(robot);
      this.viewTokenComponent.copyToken = true;
      this.translate
          .get("ROBOT_ACCOUNT.CREATED_SUCCESS", { param: robot.name })
          .subscribe((res: string) => {
            this.viewTokenComponent.createSuccess = res;
          });
      // export to token file
      const downLoadUrl = `data:text/json;charset=utf-8, ${encodeURIComponent(JSON.stringify(robot))}`;
      this.viewTokenComponent.downLoadHref = this.sanitizer.bypassSecurityTrustUrl(downLoadUrl);
      this.viewTokenComponent.downLoadFileName = `${robot.name}.json`;
    }
    this.refresh();
  }
}
